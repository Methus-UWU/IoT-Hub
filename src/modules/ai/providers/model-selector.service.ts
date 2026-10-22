import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AiChatMessageDto, AiTaskProfile } from '../dto/ai-chat.dto';
import { CatalogModel } from './model-catalog.types';

export interface ProfileWeights {
  capability: number;
  context: number;
  speed: number;
  cost: number;
  reasoning: number;
  tools: number;
  freshness: number;
}

export interface ProfileRule {
  id: Exclude<AiTaskProfile, AiTaskProfile.Auto>;
  label: string;
  description: string;
  /** A model below this context window cannot serve the profile at all. */
  minContextLength: number;
  weights: ProfileWeights;
}

export interface RankedModel {
  model: CatalogModel;
  score: number;
  /** Per-signal contribution, kept so the API can explain a pick. */
  signals: Record<keyof ProfileWeights, number>;
}

/**
 * How each task profile trades the catalog signals off against each other.
 *
 * Weights sum to 1 per profile so scores stay comparable across profiles. The
 * signals themselves are all normalized to 0..1 by `scoreModel`.
 */
export const PROFILE_RULES: readonly ProfileRule[] = [
  {
    id: AiTaskProfile.Fast,
    label: 'ตอบเร็ว',
    description: 'คำถามสั้น สรุปข้อมูล ตอบไว ใช้โมเดลเล็ก',
    minContextLength: 8_192,
    weights: {
      capability: 0.1,
      context: 0.1,
      speed: 0.45,
      cost: 0.25,
      reasoning: 0,
      tools: 0.05,
      freshness: 0.05,
    },
  },
  {
    id: AiTaskProfile.Balanced,
    label: 'สมดุล',
    description: 'งานทั่วไป ถาม-ตอบระบบ วิเคราะห์ระดับกลาง',
    minContextLength: 16_384,
    weights: {
      capability: 0.3,
      context: 0.2,
      speed: 0.15,
      cost: 0.15,
      reasoning: 0,
      tools: 0.1,
      freshness: 0.1,
    },
  },
  {
    id: AiTaskProfile.Deep,
    label: 'วิเคราะห์ลึก',
    description: 'หา root cause อ่าน log ยาว ต้องใช้ reasoning',
    minContextLength: 32_768,
    weights: {
      capability: 0.3,
      context: 0.25,
      speed: 0,
      cost: 0,
      reasoning: 0.3,
      tools: 0.05,
      freshness: 0.1,
    },
  },
];

/** Words that mark a request as an investigation rather than a lookup. */
const DEEP_TASK_PATTERN =
  /root cause|วิเคราะห์|สาเหตุ|ทำไม|debug|incident|ตรวจสอบ|postmortem|analy[sz]e|troubleshoot|เปรียบเทียบ|compare|ออกแบบ|design|refactor/i;

const DEEP_PROMPT_CHARS = 6_000;
const FAST_PROMPT_CHARS = 240;
const DEEP_TURN_COUNT = 10;

/** Caps used to normalize each raw signal into 0..1. */
const MAX_CONTEXT_TOKENS = 1_000_000;
const MAX_PARAMS_BILLIONS = 1_000;
const MAX_PRICE_PER_MILLION = 10;
const FRESHNESS_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
/**
 * Plenty of ids carry no parameter count. Scoring those as 0 would make every
 * unlabelled model look tiny — a free win on `speed` and a free loss on
 * `capability` — so an unknown size scores neutral instead.
 */
const UNKNOWN_SIZE_SCORE = 0.5;

function logScore(value: number, cap: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, Math.log10(1 + value) / Math.log10(1 + cap));
}

function scoreModel(model: CatalogModel, now: number): RankedModel['signals'] {
  const age = model.createdAt ? now - Date.parse(model.createdAt) : undefined;
  return {
    capability: model.totalParamsBillions
      ? logScore(model.totalParamsBillions, MAX_PARAMS_BILLIONS)
      : UNKNOWN_SIZE_SCORE,
    context: logScore(model.contextLength, MAX_CONTEXT_TOKENS),
    // Active parameters drive latency, so a sparse MoE scores as fast as a
    // dense model of its active size.
    speed: model.activeParamsBillions
      ? 1 - logScore(model.activeParamsBillions, MAX_PARAMS_BILLIONS)
      : UNKNOWN_SIZE_SCORE,
    cost: model.isFree
      ? 1
      : Number.isFinite(model.promptPricePerMillion)
        ? 1 - Math.min(1, model.promptPricePerMillion / MAX_PRICE_PER_MILLION)
        : 0,
    reasoning: model.supportsReasoning ? 1 : 0,
    tools: model.supportsTools ? 1 : 0,
    freshness:
      age === undefined || Number.isNaN(age)
        ? 0.5
        : Math.max(0, 1 - age / FRESHNESS_WINDOW_MS),
  };
}

/**
 * Ranks the live catalog for a task profile instead of reading a pinned model
 * name out of the code or the environment.
 */
@Injectable()
export class ModelSelectorService {
  constructor(private readonly config: ConfigService) {}

  /** Paid models stay out of the ranking unless the operator opts in. */
  get allowPaidModels(): boolean {
    return this.config.get<string>('AI_ALLOW_PAID_MODELS')?.trim() === 'true';
  }

  get profiles(): readonly ProfileRule[] {
    return PROFILE_RULES;
  }

  /** Shared by the IDE and admin chat: saved pins, environment pins, then ranking. */
  assistantCandidates(
    models: CatalogModel[],
    profile: Exclude<AiTaskProfile, AiTaskProfile.Auto>,
    adminOrder: string[] = [],
  ): CatalogModel[] {
    const ranked = this.rank(
      models,
      profile === AiTaskProfile.Fast ? AiTaskProfile.Balanced : profile,
    );
    const withTools = ranked.filter(({ model }) => model.supportsTools);
    const candidates = (withTools.length ? withTools : ranked).map(
      ({ model }) => model,
    );
    const ids = adminOrder.length
      ? adminOrder
      : (this.config.get<string>('AI_PROJECT_MODEL') ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
    // Operator pins authorize only these paid models, not the rest of the catalog.
    const pinned = ids
      .map((id) => models.find((model) => model.id === id))
      .filter((model): model is CatalogModel => Boolean(model));
    const ordered = [
      ...new Map(
        [...pinned, ...candidates].map((model) => [model.id, model]),
      ).values(),
    ];
    if (!ordered.length) {
      throw new BadRequestException({
        code: 'AI_NO_ELIGIBLE_MODEL',
        message:
          'No AI model in the OpenRouter catalog matches the current policy',
      });
    }
    return ordered.slice(0, 3);
  }

  rule(profile: Exclude<AiTaskProfile, AiTaskProfile.Auto>): ProfileRule {
    const found = PROFILE_RULES.find((item) => item.id === profile);
    if (!found) throw new Error(`Unknown AI task profile: ${profile}`);
    return found;
  }

  /**
   * Picks the profile that fits the conversation: long or investigative
   * requests go deep, one-line lookups go fast, everything else is balanced.
   */
  inferProfile(
    messages: AiChatMessageDto[],
  ): Exclude<AiTaskProfile, AiTaskProfile.Auto> {
    const text = messages.map((message) => message.content).join('\n');
    if (
      text.length >= DEEP_PROMPT_CHARS ||
      messages.length >= DEEP_TURN_COUNT ||
      DEEP_TASK_PATTERN.test(text)
    ) {
      return AiTaskProfile.Deep;
    }
    return text.length <= FAST_PROMPT_CHARS
      ? AiTaskProfile.Fast
      : AiTaskProfile.Balanced;
  }

  /** The models a request is allowed to reach, before profile ranking. */
  eligible(models: CatalogModel[]): CatalogModel[] {
    return this.allowPaidModels
      ? models
      : models.filter((model) => model.isFree);
  }

  /**
   * Ranks every eligible model for the profile, best first. Falls back to the
   * unfiltered eligible set when the context floor excludes everything, so a
   * thin catalog still yields an answer.
   *
   * The `reasoning` signal is close to worthless on the free catalog, where every
   * model currently declares it. Do not reach for it to separate a fast model from a
   * slow one: what a model emits before it answers is not in this data, and a filter
   * on it empties the candidate set instead of reordering it. `ProjectAiService`
   * handles the latency problem where it belongs, by not running a tool loop on the
   * latency tier at all.
   */
  rank(
    models: CatalogModel[],
    profile: Exclude<AiTaskProfile, AiTaskProfile.Auto>,
  ): RankedModel[] {
    const rule = this.rule(profile);
    const eligible = this.eligible(models);
    const withinFloor = eligible.filter(
      (model) => model.contextLength >= rule.minContextLength,
    );
    const candidates = withinFloor.length ? withinFloor : eligible;
    const now = Date.now();

    return candidates
      .map((model) => {
        const signals = scoreModel(model, now);
        const score = (
          Object.keys(rule.weights) as (keyof ProfileWeights)[]
        ).reduce((total, key) => total + rule.weights[key] * signals[key], 0);
        return { model, score, signals };
      })
      .sort(
        (a, b) => b.score - a.score || a.model.id.localeCompare(b.model.id),
      );
  }
}
