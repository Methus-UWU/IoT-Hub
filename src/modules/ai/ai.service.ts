import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AiCreditsService } from '../ai-credits/ai-credits.service';

import { AiChatDto, AiTaskProfile } from './dto/ai-chat.dto';
import { ModelCatalogService } from './providers/model-catalog.service';
import { CatalogModel } from './providers/model-catalog.types';
import { ModelSelectorService } from './providers/model-selector.service';
import { OpenRouterProvider } from './providers/openrouter.provider';
import { SystemContextService } from './system-context.service';

const BASE_SYSTEM_PROMPT = `You are the IoT Hub administration assistant.
Help an authenticated administrator analyze platform health, logs, infrastructure, database behavior, users, security signals, and operational incidents.
Answer in the same language as the administrator. Be concise, evidence-based, and clearly separate observations, hypotheses, and recommended next steps.
Never claim that you changed, restarted, deleted, or deployed anything. You only analyze and recommend actions.
Never reveal secrets, environment variables, access tokens, API keys, passwords, or private connection strings.`;

const DEFAULT_MAX_OUTPUT_TOKENS = 1600;
const DEFAULT_MODELS_PER_VENDOR = 8;

/**
 * Display names for vendor slugs whose casing cannot be derived from the slug.
 * Cosmetic only: an unlisted vendor still appears, title-cased from its slug.
 */
const VENDOR_LABELS: Readonly<Record<string, string>> = {
  ai21: 'AI21',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  mistralai: 'Mistral AI',
  nvidia: 'NVIDIA',
  openai: 'OpenAI',
  'x-ai': 'xAI',
  'z-ai': 'Z.ai',
};

export interface AiCatalogModel {
  id: string;
  name: string;
  vendor: string;
  contextLength: number;
  isFree: boolean;
  supportsReasoning: boolean;
  supportsTools: boolean;
  promptPricePerMillion: number;
  completionPricePerMillion: number;
  paramsBillions?: number;
}

export interface AiVendorGroup {
  id: string;
  label: string;
  models: AiCatalogModel[];
}

export interface AiProfileOption {
  id: AiTaskProfile;
  label: string;
  description: string;
  /** What the ranker would pick right now, so the UI can show the effect. */
  recommendedModel?: AiCatalogModel;
}

export interface AiCatalogResult {
  configured: boolean;
  /** True when the live catalog fetch failed and this is cached or fallback data. */
  stale: boolean;
  fetchedAt: string;
  allowPaidModels: boolean;
  profiles: AiProfileOption[];
  vendors: AiVendorGroup[];
}

export interface AiChatResult {
  id: string;
  model: string;
  vendor: string;
  profile: AiTaskProfile;
  /** True when the server chose the model instead of honouring an override. */
  autoSelected: boolean;
  content: string;
  createdAt: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

function vendorLabel(vendor: string): string {
  return (
    VENDOR_LABELS[vendor] ??
    vendor
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

function toCatalogModel(model: CatalogModel): AiCatalogModel {
  return {
    id: model.id,
    name: model.name,
    vendor: model.vendor,
    contextLength: model.contextLength,
    isFree: model.isFree,
    supportsReasoning: model.supportsReasoning,
    supportsTools: model.supportsTools,
    promptPricePerMillion: Number.isFinite(model.promptPricePerMillion)
      ? model.promptPricePerMillion
      : 0,
    completionPricePerMillion: Number.isFinite(model.completionPricePerMillion)
      ? model.completionPricePerMillion
      : 0,
    paramsBillions: model.totalParamsBillions,
  };
}

@Injectable()
export class AiService {
  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly selector: ModelSelectorService,
    private readonly provider: OpenRouterProvider,
    private readonly systemContext: SystemContextService,
    private readonly config: ConfigService,
    private readonly credits: AiCreditsService,
  ) {}

  /**
   * The model picker payload: task profiles plus the live catalog grouped by
   * vendor. Both are derived from OpenRouter at request time.
   */
  async listCatalog(): Promise<AiCatalogResult> {
    const { models, fetchedAt, stale } = await this.catalog.load();
    const perVendor =
      Number(this.config.get<string>('AI_MODELS_PER_VENDOR')) ||
      DEFAULT_MODELS_PER_VENDOR;

    // One balanced ranking drives both the vendor lists and the ordering
    // inside each group, so the picker leads with the strongest options.
    const ranked = this.selector.rank(models, AiTaskProfile.Balanced);
    const groups = new Map<string, AiCatalogModel[]>();
    for (const { model } of ranked) {
      const bucket = groups.get(model.vendor) ?? [];
      if (bucket.length >= perVendor) continue;
      bucket.push(toCatalogModel(model));
      groups.set(model.vendor, bucket);
    }

    return {
      configured: this.catalog.configured,
      stale,
      fetchedAt,
      allowPaidModels: this.selector.allowPaidModels,
      profiles: [
        {
          id: AiTaskProfile.Auto,
          label: 'อัตโนมัติ',
          description: 'ให้ระบบเลือก profile จากเนื้อหาที่ถาม',
        },
        ...this.selector.profiles.map((rule) => ({
          id: rule.id,
          label: rule.label,
          description: rule.description,
          recommendedModel: this.selector
            .rank(models, rule.id)
            .slice(0, 1)
            .map(({ model }) => toCatalogModel(model))[0],
        })),
      ],
      vendors: [...groups.entries()]
        .map(([id, vendorModels]) => ({
          id,
          label: vendorLabel(id),
          models: vendorModels,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }

  async chat(dto: AiChatDto, signal?: AbortSignal): Promise<AiChatResult> {
    const [{ models }, modelOrder] = await Promise.all([
      this.catalog.load(),
      this.credits.modelOrder(),
    ]);
    const candidates = this.selector.assistantCandidates(
      models,
      this.selector.inferProfile(dto.messages),
      modelOrder,
    );
    const liveContext = dto.includeSystemContext
      ? await this.systemContext.build()
      : 'Live system context was not requested.';

    return this.complete(
      {
        systemPrompt: `${BASE_SYSTEM_PROMPT}\n\nCurrent read-only system context:\n${liveContext}`,
        messages: dto.messages,
        modelOrder: candidates.map((model) => model.id),
      },
      signal,
    );
  }

  /**
   * One model turn under the platform's model policy: the profile (or an allowed
   * override) picks the model, and output is capped by configuration. Every
   * assistant that is a plain conversation goes through here, so the policy is
   * enforced in one place.
   */
  async complete(
    request: {
      systemPrompt: string;
      messages: AiChatDto['messages'];
      profile?: AiTaskProfile;
      model?: string;
      /** The admin's primary and fallbacks; used when no explicit model is asked for. */
      modelOrder?: string[];
    },
    signal?: AbortSignal,
  ): Promise<AiChatResult> {
    const { models } = await this.catalog.load();
    const requestedProfile = request.profile ?? AiTaskProfile.Auto;
    const profile =
      requestedProfile === AiTaskProfile.Auto
        ? this.selector.inferProfile(request.messages)
        : requestedProfile;

    const override = request.model?.trim();
    // Pinned by an admin: consent to those models, paid or not, like AI_PROJECT_MODEL.
    const pinned = override
      ? []
      : (request.modelOrder ?? [])
          .map((id) => models.find((model) => model.id === id))
          .filter((model): model is CatalogModel => Boolean(model));
    const chosen = override
      ? this.resolveOverride(models, override)
      : (pinned[0] ?? this.resolveByProfile(models, profile));
    const { systemPrompt, messages } = request;

    const configuredMax =
      Number(this.config.get<string>('AI_MAX_OUTPUT_TOKENS')) ||
      DEFAULT_MAX_OUTPUT_TOKENS;
    const result = await this.provider.generate({
      model: chosen.id,
      ...(pinned.length > 1
        ? { fallbackModels: pinned.slice(1).map((model) => model.id) }
        : {}),
      messages,
      systemPrompt,
      maxOutputTokens: Math.min(
        configuredMax,
        chosen.maxCompletionTokens ?? configuredMax,
      ),
      signal,
    });

    return {
      id: randomUUID(),
      model: result.servedModel ?? chosen.id,
      vendor:
        models.find((model) => model.id === result.servedModel)?.vendor ??
        chosen.vendor,
      profile: requestedProfile,
      autoSelected: !override,
      content: result.content,
      createdAt: new Date().toISOString(),
      usage: result.usage,
    };
  }

  private resolveOverride(
    models: CatalogModel[],
    modelId: string,
  ): CatalogModel {
    const match = models.find((model) => model.id === modelId);
    if (!match) {
      throw new BadRequestException(
        `Model "${modelId}" is not in the OpenRouter catalog`,
      );
    }
    if (!this.selector.eligible([match]).length) {
      throw new BadRequestException(
        `Model "${modelId}" is a paid model and AI_ALLOW_PAID_MODELS is not enabled`,
      );
    }
    return match;
  }

  private resolveByProfile(
    models: CatalogModel[],
    profile: Exclude<AiTaskProfile, AiTaskProfile.Auto>,
  ): CatalogModel {
    const best = this.selector.rank(models, profile)[0];
    if (!best) {
      throw new BadRequestException(
        'No AI model in the OpenRouter catalog matches the current policy',
      );
    }
    return best.model;
  }
}
