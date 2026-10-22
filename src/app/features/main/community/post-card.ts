import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { RouterLink } from '@angular/router';

import {
  CommunityPostKind,
  CommunityApiService,
  CommunityPostSummary,
  VoteValue,
} from '../../../core/services/community-api.service';
import { RelativeTimePipe } from '../../../shared/pipes/relative-time.pipe';
import { MarkdownPipe } from '../../../shared/pipes/markdown.pipe';
import { AuthorBadge } from './author-badge';
import { VoteControl } from './vote-control';

const KIND_LABELS: Record<CommunityPostKind, string> = {
  question: 'คำถาม',
  discussion: 'พูดคุย',
  showcase: 'อวดผลงาน',
};

/** How long the share button stays in its confirmed state. */
const SHARE_FEEDBACK_MS = 2000;

/** One row of the feed. Holds no post state; the store owns what it renders. */
@Component({
  selector: 'app-community-post-card',
  imports: [RouterLink, RelativeTimePipe, MarkdownPipe, AuthorBadge, VoteControl],
  templateUrl: './post-card.html',
  styleUrl: './post-card.css',
})
export class CommunityPostCard {
  private readonly api = inject(CommunityApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly previewElement = viewChild<ElementRef<HTMLElement>>('previewElement');
  private readonly contentElement = viewChild<ElementRef<HTMLElement>>('contentElement');
  private readonly fullBody = signal<string | null>(null);
  private readonly overflowing = signal(false);
  protected readonly expanded = signal(false);
  protected readonly loadingBody = signal(false);
  protected readonly bodyError = signal(false);
  readonly post = input.required<CommunityPostSummary>();
  readonly canVote = input(true);
  readonly basePath = input('/community');

  readonly vote = output<VoteValue>();
  readonly tagSelected = output<string>();

  protected readonly content = computed(() => this.fullBody() ?? this.post().markdownPreview ?? this.post().excerpt);
  protected readonly usesMarkdown = computed(() => this.fullBody() !== null || this.post().markdownPreview !== undefined);
  protected readonly canExpand = computed(() =>
    this.expanded() || this.overflowing() || this.post().markdownPreviewTruncated !== false,
  );

  constructor() {
    afterRenderEffect((onCleanup) => {
      const preview = this.previewElement()?.nativeElement;
      const content = this.contentElement()?.nativeElement;
      if (!preview || !content || this.expanded()) return;
      const observer = new ResizeObserver(() => {
        this.overflowing.set(content.scrollHeight > preview.clientHeight + 1);
      });
      observer.observe(content);
      observer.observe(preview);
      onCleanup(() => observer.disconnect());
    });
  }

  protected toggleContent(): void {
    if (this.loadingBody()) return;
    if (this.expanded()) {
      this.expanded.set(false);
      return;
    }
    if (this.fullBody() !== null) {
      this.expanded.set(true);
      return;
    }
    this.loadingBody.set(true);
    this.bodyError.set(false);
    this.api.getPost(this.post().slug).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loadingBody.set(false)),
    ).subscribe({
      next: (post) => {
        this.fullBody.set(post.body);
        this.expanded.set(true);
      },
      error: () => this.bodyError.set(true),
    });
  }

  protected readonly kindLabel = computed(() => KIND_LABELS[this.post().kind]);

  private readonly shared = signal(false);
  protected readonly shareLabel = computed(() =>
    this.shared() ? 'คัดลอกลิงก์แล้ว' : 'แชร์',
  );

  /**
   * Copies the thread's link.
   *
   * `navigator.clipboard` is absent over plain HTTP and can be refused outright,
   * so a failure leaves the label alone rather than claiming a copy that did not
   * happen.
   */
  protected async share(): Promise<void> {
    const url = new URL(`/community/${this.post().slug}`, location.origin).href;

    try {
      await navigator.clipboard?.writeText(url);
      this.shared.set(true);
      setTimeout(() => this.shared.set(false), SHARE_FEEDBACK_MS);
    } catch {
      this.shared.set(false);
    }
  }
}
