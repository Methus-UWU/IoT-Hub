import { Service, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  CommunityApiService,
  CommunityFeedSort,
  CommunityPostSummary,
  CommunityTag,
  VoteValue,
} from '../../../core/services/community-api.service';

export interface FeedFilters {
  sort: CommunityFeedSort;
  tag: string | null;
  search: string;
}

const INITIAL_FILTERS: FeedFilters = { sort: 'new', tag: null, search: '' };

/**
 * The community feed's state.
 *
 * Paging is append-only and cursor-based, so "โหลดเพิ่ม" never re-reads what is
 * already on screen. Changing a filter starts a new feed rather than merging:
 * a cursor belongs to one sort order and means nothing under another.
 *
 * Every load carries a generation number. A slow first page that arrives after
 * the user has already changed the filter is discarded instead of overwriting
 * the newer list.
 */
@Service()
export class CommunityFeedStore {
  private readonly api = inject(CommunityApiService);

  private readonly postState = signal<CommunityPostSummary[]>([]);
  private readonly tagState = signal<CommunityTag[]>([]);
  private readonly filterState = signal<FeedFilters>(INITIAL_FILTERS);
  private readonly cursorState = signal<string | null>(null);
  private readonly loadingState = signal(false);
  private readonly loadingMoreState = signal(false);
  private readonly pendingTagLoads = signal(0);
  private readonly loadedState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private generation = 0;

  readonly posts = this.postState.asReadonly();
  readonly tags = this.tagState.asReadonly();
  readonly filters = this.filterState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly loadingMore = this.loadingMoreState.asReadonly();
  readonly tagsLoading = computed(() => this.pendingTagLoads() > 0);
  readonly error = this.errorState.asReadonly();
  readonly hasMore = computed(() => this.cursorState() !== null);
  /** True once a load finished, so the page can tell "empty" from "not yet". */
  readonly hasLoaded = computed(() => this.loadedState() && !this.loadingState());

  /**
   * Loads the tag catalog, skipping the request when it is already in hand.
   *
   * `force` re-reads the counts, which is what every feed load does: the numbers
   * beside each tag move whenever anyone posts or deletes, and a cached list
   * would keep showing a count for a post that is gone.
   */
  async loadTags(force = false): Promise<void> {
    if (!force && this.tagState().length > 0) return;

    this.pendingTagLoads.update((count) => count + 1);
    try {
      this.tagState.set(await firstValueFrom(this.api.listTags()));
    } catch {
      // The rail is a convenience; the feed still works without it.
      if (this.tagState().length === 0) this.tagState.set([]);
    } finally {
      this.pendingTagLoads.update((count) => count - 1);
    }
  }

  setSort(sort: CommunityFeedSort): void {
    if (this.filterState().sort === sort) return;
    this.filterState.update((filters) => ({ ...filters, sort }));
    void this.reload();
  }

  /** Passing the tag already selected clears it, so the chip toggles. */
  toggleTag(slug: string): void {
    this.filterState.update((filters) => ({
      ...filters,
      tag: filters.tag === slug ? null : slug,
    }));
    void this.reload();
  }

  setSearch(search: string): void {
    if (this.filterState().search === search) return;
    this.filterState.update((filters) => ({ ...filters, search }));
    void this.reload();
  }

  async reload(): Promise<void> {
    const generation = ++this.generation;
    const filters = this.filterState();

    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      const page = await firstValueFrom(
        this.api.listPosts({
          sort: filters.sort,
          tag: filters.tag ?? undefined,
          q: filters.search || undefined,
        }),
      );
      if (generation !== this.generation) return;

      this.postState.set(page.posts);
      this.cursorState.set(page.nextCursor);
      this.loadedState.set(true);
      // Counts only, and never blocking the feed on them.
      void this.loadTags(true);
    } catch {
      if (generation !== this.generation) return;
      this.errorState.set('โหลดกระทู้ไม่สำเร็จ ลองใหม่อีกครั้ง');
      this.loadedState.set(true);
    } finally {
      if (generation === this.generation) this.loadingState.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this.cursorState();
    if (!cursor || this.loadingMoreState()) return;

    const generation = this.generation;
    const filters = this.filterState();
    this.loadingMoreState.set(true);

    try {
      const page = await firstValueFrom(
        this.api.listPosts({
          sort: filters.sort,
          tag: filters.tag ?? undefined,
          q: filters.search || undefined,
          cursor,
        }),
      );
      if (generation !== this.generation) return;

      this.postState.update((posts) => [...posts, ...page.posts]);
      this.cursorState.set(page.nextCursor);
    } catch {
      if (generation === this.generation) {
        this.errorState.set('โหลดเพิ่มไม่สำเร็จ ลองใหม่อีกครั้ง');
      }
    } finally {
      this.loadingMoreState.set(false);
    }
  }

  /**
   * Sends a vote and writes back the server's numbers.
   *
   * The arrow lights up immediately because waiting a round trip to acknowledge
   * a click feels broken, but the score that ends up on screen is always the
   * one the API returned — a rejected vote rolls the row back.
   */
  async vote(postId: string, value: VoteValue): Promise<void> {
    const before = this.postState().find((post) => post.id === postId);
    if (!before) return;

    this.patchPost(postId, {
      viewerVote: value,
      score: before.score - before.viewerVote + value,
    });

    try {
      const result = await firstValueFrom(this.api.votePost(postId, value));
      this.patchPost(postId, result);
    } catch {
      this.patchPost(postId, {
        viewerVote: before.viewerVote,
        score: before.score,
      });
    }
  }

  /** Drops a deleted post without refetching the page it sat on. */
  removePost(postId: string): void {
    this.postState.update((posts) => posts.filter((post) => post.id !== postId));
  }

  private patchPost(postId: string, patch: Partial<CommunityPostSummary>): void {
    this.postState.update((posts) =>
      posts.map((post) => (post.id === postId ? { ...post, ...patch } : post)),
    );
  }
}
