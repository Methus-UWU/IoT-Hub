import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import {
  CommunityPostKind,
  VoteValue,
} from '../../../core/services/community-api.service';
import { MarkdownPipe } from '../../../shared/pipes/markdown.pipe';
import { RelativeTimePipe } from '../../../shared/pipes/relative-time.pipe';
import { AuthorBadge } from './author-badge';
import { PostThreadStore } from './post-thread.store';
import { VoteControl } from './vote-control';
import { CommunityPostSkeleton } from './community-post-skeleton';
import { communityBasePath } from './community-route';

const KIND_LABELS: Record<CommunityPostKind, string> = {
  question: 'คำถาม',
  discussion: 'พูดคุย',
  showcase: 'อวดผลงาน',
};

/** Mirrors the API's comment DTO, so the button disables before a refusal. */
const ANSWER_MIN_LENGTH = 2;

/**
 * One question and its answers.
 *
 * Readable signed out; every write control either disappears or routes to sign
 * in. That is presentation only — the API authorizes each write again, so a
 * visitor who reaches a control anyway still cannot use it.
 *
 * Bodies are Markdown, rendered through the sanitizing pipe. They are written by
 * other users, so nothing here may bypass it.
 */
@Component({
  selector: 'app-community-post-page',
  imports: [RouterLink, MarkdownPipe, RelativeTimePipe, AuthorBadge, VoteControl, CommunityPostSkeleton],
  providers: [PostThreadStore],
  templateUrl: './community-post.page.html',
  styleUrl: './community-post.page.css',
})
export class CommunityPostPage {
  private readonly store = inject(PostThreadStore);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly communityPath = communityBasePath(this.router.url);

  protected readonly post = this.store.post;
  protected readonly threads = this.store.threads;
  protected readonly answerCount = this.store.answerCount;
  protected readonly loading = this.store.loading;
  protected readonly error = this.store.error;
  protected readonly submitting = this.store.submitting;
  protected readonly signedIn = this.auth.isAuthenticated;

  protected readonly answerDraft = signal('');
  protected readonly answerError = signal<string | null>(null);
  /** The answer a reply box is currently open under, if any. */
  protected readonly replyingTo = signal<string | null>(null);
  protected readonly replyDraft = signal('');
  /** The answer being edited in place, if any. */
  protected readonly editingId = signal<string | null>(null);
  protected readonly editDraft = signal('');
  /** Two-step delete: the confirm row replaces the button rather than a dialog. */
  protected readonly pendingDelete = signal<string | null>(null);
  protected readonly deletingPost = signal(false);
  /**
   * Answers the reader has folded away.
   *
   * Held here rather than on the comment so that collapsing survives a vote or
   * an edit writing a fresh object back into the store.
   */
  private readonly collapsedIds = signal<ReadonlySet<string>>(new Set());

  protected readonly kindLabel = computed(() => {
    const post = this.post();
    return post ? KIND_LABELS[post.kind] : '';
  });

  protected readonly canSubmitAnswer = computed(
    () => this.answerDraft().trim().length >= ANSWER_MIN_LENGTH,
  );

  constructor() {
    // The route is reused when one thread links to another, so the slug is read
    // as a stream rather than once from the snapshot.
    this.route.paramMap
      .pipe(
        map((params) => params.get('slug')),
        takeUntilDestroyed(),
      )
      .subscribe((slug) => {
        if (slug) void this.store.load(slug);
      });
  }

  protected isCollapsed(commentId: string): boolean {
    return this.collapsedIds().has(commentId);
  }

  protected toggleCollapsed(commentId: string): void {
    this.collapsedIds.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(commentId)) next.add(commentId);
      return next;
    });
  }

  protected votePost(value: VoteValue): void {
    if (!this.requireAccount()) return;
    void this.store.votePost(value);
  }

  protected voteComment(commentId: string, value: VoteValue): void {
    if (!this.requireAccount()) return;
    void this.store.voteComment(commentId, value);
  }

  protected updateAnswerDraft(event: Event): void {
    this.answerDraft.set((event.target as HTMLTextAreaElement).value);
  }

  protected updateReplyDraft(event: Event): void {
    this.replyDraft.set((event.target as HTMLTextAreaElement).value);
  }

  protected updateEditDraft(event: Event): void {
    this.editDraft.set((event.target as HTMLTextAreaElement).value);
  }

  protected async submitAnswer(): Promise<void> {
    if (!this.requireAccount() || !this.canSubmitAnswer()) return;

    const message = await this.store.addComment(this.answerDraft().trim());
    this.answerError.set(message);
    if (!message) this.answerDraft.set('');
  }

  protected startReply(answerId: string): void {
    if (!this.requireAccount()) return;
    this.replyingTo.set(answerId);
    this.replyDraft.set('');
  }

  protected cancelReply(): void {
    this.replyingTo.set(null);
    this.replyDraft.set('');
  }

  protected async submitReply(answerId: string): Promise<void> {
    const body = this.replyDraft().trim();
    if (body.length < ANSWER_MIN_LENGTH) return;

    const message = await this.store.addComment(body, answerId);
    this.answerError.set(message);
    if (!message) this.cancelReply();
  }

  protected startEdit(commentId: string, body: string): void {
    this.editingId.set(commentId);
    this.editDraft.set(body);
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editDraft.set('');
  }

  protected async submitEdit(commentId: string): Promise<void> {
    const body = this.editDraft().trim();
    if (body.length < ANSWER_MIN_LENGTH) return;

    const message = await this.store.updateComment(commentId, body);
    this.answerError.set(message);
    if (!message) this.cancelEdit();
  }

  protected askDelete(commentId: string): void {
    this.pendingDelete.set(commentId);
  }

  protected cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  protected async confirmDelete(commentId: string): Promise<void> {
    this.pendingDelete.set(null);
    await this.store.deleteComment(commentId);
  }

  protected toggleAccepted(commentId: string): void {
    void this.store.toggleAccepted(commentId);
  }

  protected async deletePost(): Promise<void> {
    this.deletingPost.set(false);
    if (await this.store.deletePost()) {
      await this.router.navigate([this.communityPath]);
    }
  }

  protected askDeletePost(): void {
    this.deletingPost.set(true);
  }

  protected cancelDeletePost(): void {
    this.deletingPost.set(false);
  }

  /** Sends a signed-out visitor to sign in and reports whether to continue. */
  private requireAccount(): boolean {
    if (this.signedIn()) return true;
    void this.router.navigate(['/auth/login']);
    return false;
  }
}
