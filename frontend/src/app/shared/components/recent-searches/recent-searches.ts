import { Component, afterNextRender, computed, inject, input, output } from '@angular/core';

import { AuthService } from '../../../core/services/auth.service';
import {
  SearchHistoryService,
  type SearchScope,
} from '../../../core/services/search-history.service';

/** The signed-in user's recent searches for one scope, as one-click chips. */
@Component({
  selector: 'app-recent-searches',
  template: `
    @if (queries().length) {
      <div class="recent-searches" role="group" aria-label="การค้นหาล่าสุด">
        <span class="recent-label">ค้นหาล่าสุด</span>
        @for (query of queries(); track query) {
          <button type="button" class="recent-chip" (click)="picked.emit(query)">{{ query }}</button>
        }
        <button type="button" class="recent-clear" (click)="history.clear(scope())">
          ล้างประวัติ
        </button>
      </div>
    }
  `,
  styles: `
    .recent-searches {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.375rem;
      margin-top: 0.5rem;
      font-size: 0.8125rem;
    }
    .recent-label {
      color: #6b7280;
      margin-right: 0.25rem;
    }
    .recent-chip {
      max-width: 14rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 0.125rem 0.625rem;
      border: 1px solid #e5e7eb;
      border-radius: 999px;
      background: #fff;
      color: #374151;
      cursor: pointer;
    }
    .recent-chip:hover {
      border-color: #9ca3af;
    }
    .recent-clear {
      border: 0;
      background: none;
      color: #6b7280;
      text-decoration: underline;
      text-underline-offset: 3px;
      cursor: pointer;
    }
    .recent-chip:focus-visible,
    .recent-clear:focus-visible {
      outline: 2px solid #6b7280;
      outline-offset: 2px;
    }
  `,
})
export class RecentSearches {
  readonly scope = input.required<SearchScope>();
  readonly picked = output<string>();

  protected readonly history = inject(SearchHistoryService);
  private readonly auth = inject(AuthService);
  protected readonly queries = computed(() =>
    this.auth.isAuthenticated() ? this.history.recent(this.scope())() : [],
  );

  constructor() {
    // Inputs are bound by the first render, not in the constructor.
    afterNextRender(() => this.history.load(this.scope()));
  }
}
