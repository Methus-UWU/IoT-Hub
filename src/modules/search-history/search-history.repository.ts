export const SEARCH_SCOPES = ['documents', 'community'] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export interface SearchHistoryView {
  query: string;
  createdAt: Date;
}

export abstract class SearchHistoryRepository {
  /**
   * Records a search, moving a repeated query to the top, then trims the scope to
   * the newest `keep` entries — one transaction, so the list never exceeds it.
   */
  abstract record(
    userId: string,
    scope: SearchScope,
    query: string,
    keep: number,
  ): Promise<void>;

  /** Newest first, at most `limit`. */
  abstract list(
    userId: string,
    scope: SearchScope,
    limit: number,
  ): Promise<SearchHistoryView[]>;

  abstract clear(userId: string, scope: SearchScope): Promise<void>;
}
