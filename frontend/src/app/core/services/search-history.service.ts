import { HttpClient } from '@angular/common/http';
import { Service, inject, signal } from '@angular/core';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export type SearchScope = 'documents' | 'community';

interface SearchHistoryEntry {
  query: string;
  createdAt: string;
}

/** Wait this long after typing stops before a query counts as a search. */
const SETTLE_MS = 1500;
const MIN_LENGTH = 2;
const MAX_ENTRIES = 10;

/**
 * The signed-in user's recent searches per scope, stored by the API.
 *
 * A query is remembered once typing has settled, so the half-typed "dh" on the
 * way to "dht22" is not saved. Guests keep nothing. Every call is best effort: a
 * history failure must never get in the way of the search itself.
 */
@Service()
export class SearchHistoryService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly url = `${environment.apiUrl}me/search-history`;
  private readonly timers = new Map<SearchScope, ReturnType<typeof setTimeout>>();
  private readonly state = {
    documents: signal<readonly string[]>([]),
    community: signal<readonly string[]>([]),
  } satisfies Record<SearchScope, unknown>;

  recent(scope: SearchScope) {
    return this.state[scope].asReadonly();
  }

  load(scope: SearchScope): void {
    if (!this.auth.isAuthenticated()) return;
    this.http.get<SearchHistoryEntry[]>(this.url, { params: { scope } }).subscribe({
      next: (entries) => this.state[scope].set(entries.map((entry) => entry.query)),
      error: () => undefined,
    });
  }

  /** Call on every keystroke; only a settled query is sent. */
  remember(scope: SearchScope, rawQuery: string): void {
    clearTimeout(this.timers.get(scope));
    const query = rawQuery.trim().replace(/\s+/g, ' ');
    if (query.length < MIN_LENGTH || query.length > 100 || !this.auth.isAuthenticated()) return;

    this.timers.set(
      scope,
      setTimeout(() => {
        this.state[scope].update((queries) =>
          [query, ...queries.filter((existing) => existing !== query)].slice(0, MAX_ENTRIES),
        );
        this.http.post<void>(this.url, { scope, query }).subscribe({ error: () => undefined });
      }, SETTLE_MS),
    );
  }

  clear(scope: SearchScope): void {
    clearTimeout(this.timers.get(scope));
    this.state[scope].set([]);
    this.http
      .delete<void>(this.url, { params: { scope } })
      .subscribe({ error: () => this.load(scope) });
  }
}
