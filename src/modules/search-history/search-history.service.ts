import { Injectable } from '@nestjs/common';

import {
  SearchHistoryRepository,
  SearchHistoryView,
  SearchScope,
} from './search-history.repository';

/** How many recent searches each user keeps per scope. */
export const SEARCH_HISTORY_LIMIT = 10;

/**
 * A user's recent searches, per scope, so they can repeat one in a click.
 * Private to the user: every method is keyed by the authenticated id.
 */
@Injectable()
export class SearchHistoryService {
  constructor(private readonly history: SearchHistoryRepository) {}

  record(userId: string, scope: SearchScope, query: string): Promise<void> {
    return this.history.record(userId, scope, query, SEARCH_HISTORY_LIMIT);
  }

  list(userId: string, scope: SearchScope): Promise<SearchHistoryView[]> {
    return this.history.list(userId, scope, SEARCH_HISTORY_LIMIT);
  }

  clear(userId: string, scope: SearchScope): Promise<void> {
    return this.history.clear(userId, scope);
  }
}
