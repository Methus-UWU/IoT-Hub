import { Component, computed, inject, signal } from '@angular/core';
import { SearchHistoryService } from '../../../core/services/search-history.service';
import { RecentSearches } from '../../../shared/components/recent-searches/recent-searches';
import { Router } from '@angular/router';

import { AuthService } from '../../../core/services/auth.service';
import { CommunityFeedSort, VoteValue } from '../../../core/services/community-api.service';
import { AskQuestionPage } from './ask-question.page';
import { AuthorBadge } from './author-badge';
import { CommunityFeedStore } from './community.store';
import { CommunityPostCard } from './post-card';
import { CommunityPostSkeleton } from './community-post-skeleton';
import { CommunityFeedSkeleton } from './community-feed-skeleton';
import { communityBasePath } from './community-route';

interface SortTab {
  value: CommunityFeedSort;
  label: string;
  /** Path data for the tab's glyph, so the markup stays one loop. */
  icon: string;
}

const SORT_TABS: readonly SortTab[] = [
  { value: 'new', label: 'ล่าสุด', icon: 'M10 5.5v5l3 2M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z' },
  { value: 'active', label: 'เคลื่อนไหว', icon: 'm3 12 3.5-4 3 3L14 5l3 3' },
  {
    value: 'top',
    label: 'ยอดนิยม',
    icon: 'M10 3.5 12 8l4.5.5-3.4 3.1.9 4.6L10 14l-4 2.2.9-4.6L3.5 8.5 8 8l2-4.5Z',
  },
];

/** How long the page waits after a keystroke before asking the API. */
const SEARCH_DEBOUNCE_MS = 350;

/**
 * The community feed.
 *
 * Readable signed out, which is why nothing here is behind a guard. The only
 * difference for a visitor is that voting and posting send them to sign in
 * first — the API would refuse them anyway, so the redirect is the honest
 * version of a disabled button.
 */
@Component({
  selector: 'app-community-feed-page',
  imports: [
    AskQuestionPage,
    AuthorBadge,
    CommunityPostCard,
    CommunityPostSkeleton,
    CommunityFeedSkeleton,
    RecentSearches,
  ],
  templateUrl: './community-feed.page.html',
  styleUrl: './community-feed.page.css',
})
export class CommunityFeedPage {
  private readonly searchHistory = inject(SearchHistoryService);
  private readonly store = inject(CommunityFeedStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private searchTimer?: ReturnType<typeof setTimeout>;

  protected readonly sortTabs = SORT_TABS;
  protected readonly posts = this.store.posts;
  protected readonly tags = this.store.tags;
  protected readonly filters = this.store.filters;
  protected readonly loading = this.store.loading;
  protected readonly loadingMore = this.store.loadingMore;
  protected readonly tagsLoading = this.store.tagsLoading;
  protected readonly hasLoaded = this.store.hasLoaded;
  protected readonly hasMore = this.store.hasMore;
  protected readonly error = this.store.error;
  protected readonly signedIn = this.auth.isAuthenticated;
  protected readonly identityLoading = this.auth.identityLoading;
  protected readonly communityBasePath = communityBasePath(this.router.url);
  /** Mirrors the input while the debounce runs, so typing stays responsive. */
  protected readonly searchDraft = signal('');
  protected readonly composerOpen = signal(false);
  protected readonly skeletonRows = [0, 1, 2, 3, 4] as const;

  /** Drives the avatar on the composer prompt; a visitor gets a neutral one. */
  protected readonly username = computed(() =>
    this.auth.displayUsername() ?? (this.signedIn() ? 'บัญชีของคุณ' : 'ผู้เยี่ยมชม'),
  );

  protected readonly activeTagName = computed(() => {
    const slug = this.filters().tag;
    if (!slug) return null;
    return this.tags().find((tag) => tag.slug === slug)?.name ?? slug;
  });

  constructor() {
    void this.store.loadTags();
    void this.store.reload();
  }

  protected setSort(sort: CommunityFeedSort): void {
    this.store.setSort(sort);
  }

  protected toggleTag(slug: string): void {
    this.store.toggleTag(slug);
  }

  protected updateSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchDraft.set(value);

    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.store.setSearch(value.trim()), SEARCH_DEBOUNCE_MS);
    this.searchHistory.remember('community', value);
  }

  protected pickRecentSearch(query: string): void {
    clearTimeout(this.searchTimer);
    this.searchDraft.set(query);
    this.store.setSearch(query);
  }

  protected loadMore(): void {
    void this.store.loadMore();
  }

  protected retry(): void {
    void this.store.reload();
  }

  protected vote(postId: string, value: VoteValue): void {
    if (!this.signedIn()) {
      void this.router.navigate(['/auth/login']);
      return;
    }
    void this.store.vote(postId, value);
  }

  protected startPost(): void {
    if (!this.signedIn()) {
      void this.router.navigate(['/auth/login']);
      return;
    }

    this.composerOpen.set(true);
  }

  protected closeComposer(): void {
    this.composerOpen.set(false);
  }
}
