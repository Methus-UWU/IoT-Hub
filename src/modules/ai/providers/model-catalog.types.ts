/**
 * Normalized view of one entry from the OpenRouter model catalog.
 *
 * Everything here is derived from the live `GET /models` payload rather than a
 * checked-in list, so a new or retired model appears without a code change. The
 * parameter counts are the one exception: OpenRouter does not publish them, so
 * they are parsed out of the model id as a heuristic (see `parseParameterSizes`).
 */
export interface CatalogModel {
  id: string;
  name: string;
  vendor: string;
  description: string;
  contextLength: number;
  maxCompletionTokens?: number;
  promptPricePerMillion: number;
  completionPricePerMillion: number;
  isFree: boolean;
  supportsReasoning: boolean;
  supportsTools: boolean;
  /** Parsed from the id, e.g. `120b` in `nemotron-3-super-120b-a12b`. */
  totalParamsBillions?: number;
  /** Parsed from the id, e.g. `a12b`. Equals the total for dense models. */
  activeParamsBillions?: number;
  createdAt?: string;
  moderated: boolean;
}

export interface ModelCatalog {
  models: CatalogModel[];
  fetchedAt: string;
  /** True when the live fetch failed and this is a cached or fallback catalog. */
  stale: boolean;
}
