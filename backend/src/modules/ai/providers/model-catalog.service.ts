import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { asArray, asRecord, numberValue, stringValue } from './json-values';
import { CatalogModel, ModelCatalog } from './model-catalog.types';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const CATALOG_TIMEOUT_MS = 10_000;

/**
 * Total parameter count in the model id: the `70b` of `llama-3.3-70b-instruct`.
 * Anchored on a separator so it cannot match inside a version like `v2b1`.
 */
const TOTAL_PARAMS_PATTERN = /(?:^|[-_/])(\d+(?:\.\d+)?)b(?=$|[-_:])/gi;
/** Active parameter count of a mixture-of-experts id: the `a12b` of `120b-a12b`. */
const ACTIVE_PARAMS_PATTERN = /(?:^|[-_])a(\d+(?:\.\d+)?)b(?=$|[-_:])/i;

/** OpenRouter publishes prices as a per-token USD string, e.g. `"0.00000015"`. */
function pricePerMillion(value: unknown): number {
  const parsed = Number.parseFloat(stringValue(value) ?? '');
  return Number.isFinite(parsed)
    ? parsed * 1_000_000
    : Number.POSITIVE_INFINITY;
}

export function parameterSizes(modelId: string): {
  total?: number;
  active?: number;
} {
  const matches = [...modelId.matchAll(TOTAL_PARAMS_PATTERN)]
    .map((match) => Number.parseFloat(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!matches.length) return {};

  const total = Math.max(...matches);
  const activeMatch = ACTIVE_PARAMS_PATTERN.exec(modelId);
  const active = activeMatch ? Number.parseFloat(activeMatch[1]) : total;
  return {
    total,
    active: Number.isFinite(active) ? Math.min(active, total) : total,
  };
}

function toCatalogModel(raw: unknown): CatalogModel | null {
  const record = asRecord(raw);
  const id = stringValue(record?.['id']);
  if (!record || !id) return null;

  const architecture = asRecord(record['architecture']);
  const outputModalities = asArray(architecture?.['output_modalities']);
  // The chat endpoint only consumes text. A model that also emits audio or
  // images (`text+image->text+audio`) is priced and shaped nothing like a chat
  // model, so text-only output is required rather than merely included.
  if (
    !outputModalities.length ||
    outputModalities.some((modality) => modality !== 'text')
  ) {
    return null;
  }

  const pricing = asRecord(record['pricing']);
  const promptPrice = pricePerMillion(pricing?.['prompt']);
  const completionPrice = pricePerMillion(pricing?.['completion']);
  const supported = asArray(record['supported_parameters']).flatMap((value) => {
    const name = stringValue(value);
    return name ? [name] : [];
  });
  const topProvider = asRecord(record['top_provider']);
  const created = numberValue(record['created']);
  const sizes = parameterSizes(id);

  return {
    id,
    name: stringValue(record['name']) ?? id,
    vendor: id.split('/')[0] ?? 'unknown',
    description: stringValue(record['description'])?.slice(0, 400) ?? '',
    contextLength:
      numberValue(record['context_length']) ??
      numberValue(topProvider?.['context_length']) ??
      0,
    maxCompletionTokens: numberValue(topProvider?.['max_completion_tokens']),
    promptPricePerMillion: promptPrice,
    completionPricePerMillion: completionPrice,
    isFree: promptPrice === 0 && completionPrice === 0,
    supportsReasoning: supported.includes('reasoning'),
    supportsTools: supported.includes('tools'),
    totalParamsBillions: sizes.total,
    activeParamsBillions: sizes.active,
    createdAt: created ? new Date(created * 1000).toISOString() : undefined,
    moderated: topProvider?.['is_moderated'] === true,
  };
}

/**
 * Fetches and caches the OpenRouter model catalog.
 *
 * The catalog is the single source of truth for which models exist; nothing in
 * this module carries a checked-in model list. `AI_FALLBACK_MODEL` is the only
 * pinned id, and it is used solely so chat still answers when `GET /models` is
 * unreachable and the cache is cold.
 */
@Injectable()
export class ModelCatalogService {
  private readonly logger = new Logger(ModelCatalogService.name);
  private cache: ModelCatalog | null = null;
  private inFlight: Promise<ModelCatalog> | null = null;
  private latencyCache: { ids: string[]; expiresAt: number } | null = null;
  private latencyInFlight: Promise<string[]> | null = null;

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return Boolean(this.config.get<string>('OPENROUTER_API_KEY')?.trim());
  }

  get baseUrl(): string {
    return (
      this.config.get<string>('OPENROUTER_BASE_URL')?.replace(/\/$/, '') ||
      DEFAULT_BASE_URL
    );
  }

  /** Cached catalog, refreshed once the TTL expires. Never throws. */
  async load(): Promise<ModelCatalog> {
    const ttl =
      Number(this.config.get<string>('AI_CATALOG_TTL_MS')) || DEFAULT_TTL_MS;
    const cached = this.cache;
    if (
      cached &&
      !cached.stale &&
      Date.now() - Date.parse(cached.fetchedAt) < ttl
    ) {
      return cached;
    }

    // Collapse concurrent misses onto one upstream request.
    this.inFlight ??= this.refresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Provider ordering only; no latency durations are inferred from model names. */
  async latencyOrder(): Promise<string[]> {
    if (this.latencyCache && Date.now() < this.latencyCache.expiresAt) {
      return this.latencyCache.ids;
    }
    this.latencyInFlight ??= this.fetchLatencyOrder().finally(() => {
      this.latencyInFlight = null;
    });
    return this.latencyInFlight;
  }

  private async fetchLatencyOrder(): Promise<string[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/models?sort=latency-low-to-high`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) throw new Error(`status ${response.status}`);
      const payload = asRecord(await response.json());
      const ids = asArray(payload?.['data']).flatMap((raw) => {
        const id = stringValue(asRecord(raw)?.['id']);
        return id ? [id] : [];
      });
      this.latencyCache = { ids, expiresAt: Date.now() + 5 * 60_000 };
      return ids;
    } catch {
      // Failure is isolated from catalog availability and retried after one minute.
      this.latencyCache = { ids: [], expiresAt: Date.now() + 60_000 };
      return [];
    }
  }

  private async refresh(): Promise<ModelCatalog> {
    try {
      const models = await this.fetchModels();
      if (!models.length) throw new Error('empty catalog');
      this.cache = {
        models,
        fetchedAt: new Date().toISOString(),
        stale: false,
      };
      return this.cache;
    } catch (error) {
      this.logger.warn(
        `OpenRouter catalog refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      // Serve the last good catalog if there is one; only synthesize the pinned
      // fallback when the cache has never been filled.
      this.cache = this.cache
        ? { ...this.cache, stale: true }
        : {
            models: [this.fallbackModel()],
            fetchedAt: new Date().toISOString(),
            stale: true,
          };
      return this.cache;
    }
  }

  private async fetchModels(): Promise<CatalogModel[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }

    const payload = asRecord(await response.json());
    return asArray(payload?.['data']).flatMap((raw) => {
      const model = toCatalogModel(raw);
      return model ? [model] : [];
    });
  }

  private fallbackModel(): CatalogModel {
    const id =
      this.config.get<string>('AI_FALLBACK_MODEL')?.trim() ||
      'meta-llama/llama-3.3-70b-instruct:free';
    const sizes = parameterSizes(id);
    return {
      id,
      name: `${id} (fallback)`,
      vendor: id.split('/')[0] ?? 'unknown',
      description:
        'Pinned fallback used while the live OpenRouter catalog is unreachable.',
      contextLength: 32_768,
      promptPricePerMillion: 0,
      completionPricePerMillion: 0,
      isFree: id.endsWith(':free'),
      supportsReasoning: false,
      supportsTools: false,
      totalParamsBillions: sizes.total,
      activeParamsBillions: sizes.active,
      moderated: false,
    };
  }
}
