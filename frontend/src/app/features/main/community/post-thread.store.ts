import { Service, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  CommunityApiService,
  CommunityComment,
  CommunityPostDetail,
  VoteValue,
} from '../../../core/services/community-api.service';

export interface CommentThread {
  answer: CommunityComment;
  replies: CommunityComment[];
}

/**
 * One question and its answers.
 *
 * Not auto-provided by intent — the thread page lists it in its own `providers`,
 * so opening another question starts from an empty store instead of briefly
 * showing the previous thread's answers.
 *
 * Votes are applied optimistically and then overwritten by the number the API
 * returns, so a refused vote rolls back rather than sticking.
 */
@Service({ autoProvided: false })
export class PostThreadStore {
  private readonly api = inject(CommunityApiService);

  private readonly postState = signal<CommunityPostDetail | null>(null);
  private readonly commentState = signal<CommunityComment[]>([]);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly submittingState = signal(false);

  readonly post = this.postState.asReadonly();
  readonly comments = this.commentState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly submitting = this.submittingState.asReadonly();

  /**
   * Answers with their replies attached.
   *
   * The accepted answer is pinned to the top regardless of score: someone
   * opening a solved question is looking for the solution, not the most popular
   * opinion about it.
   */
  readonly threads = computed<CommentThread[]>(() => {
    const comments = this.commentState();
    const accepted = this.postState()?.acceptedCommentId ?? null;

    const replies = new Map<string, CommunityComment[]>();
    for (const comment of comments) {
      if (!comment.parentId) continue;
      const bucket = replies.get(comment.parentId) ?? [];
      bucket.push(comment);
      replies.set(comment.parentId, bucket);
    }

    return comments
      .filter((comment) => comment.parentId === null)
      .map((answer) => ({
        answer,
        replies: (replies.get(answer.id) ?? []).sort(byOldestFirst),
      }))
      .sort((left, right) => {
        if (left.answer.id === accepted) return -1;
        if (right.answer.id === accepted) return 1;
        return right.answer.score - left.answer.score;
      });
  });

  readonly answerCount = computed(
    () => this.commentState().filter((comment) => comment.parentId === null).length,
  );

  async load(slug: string): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      const post = await firstValueFrom(this.api.getPost(slug));
      this.postState.set(post);
      this.commentState.set(await firstValueFrom(this.api.listComments(post.id)));
    } catch {
      this.postState.set(null);
      this.errorState.set('ไม่พบกระทู้นี้ หรือโหลดไม่สำเร็จ');
    } finally {
      this.loadingState.set(false);
    }
  }

  async votePost(value: VoteValue): Promise<void> {
    const before = this.postState();
    if (!before) return;

    this.postState.set({
      ...before,
      viewerVote: value,
      score: before.score - before.viewerVote + value,
    });

    try {
      const result = await firstValueFrom(this.api.votePost(before.id, value));
      this.postState.update((post) => (post ? { ...post, ...result } : post));
    } catch {
      this.postState.set(before);
    }
  }

  async voteComment(commentId: string, value: VoteValue): Promise<void> {
    const before = this.commentState().find((comment) => comment.id === commentId);
    if (!before) return;

    this.patchComment(commentId, {
      viewerVote: value,
      score: before.score - before.viewerVote + value,
    });

    try {
      const result = await firstValueFrom(
        this.api.voteComment(commentId, value),
      );
      this.patchComment(commentId, result);
    } catch {
      this.patchComment(commentId, {
        viewerVote: before.viewerVote,
        score: before.score,
      });
    }
  }

  /** Returns the error message to show, or null when the answer was posted. */
  async addComment(body: string, parentId?: string): Promise<string | null> {
    const post = this.postState();
    if (!post) return 'ไม่พบกระทู้นี้';

    this.submittingState.set(true);
    try {
      const comment = await firstValueFrom(
        this.api.createComment(post.id, body, parentId),
      );
      this.commentState.update((comments) => [...comments, comment]);
      this.postState.update((current) =>
        current ? { ...current, commentCount: current.commentCount + 1 } : current,
      );
      return null;
    } catch {
      return 'ส่งคำตอบไม่สำเร็จ ลองใหม่อีกครั้ง';
    } finally {
      this.submittingState.set(false);
    }
  }

  async updateComment(commentId: string, body: string): Promise<string | null> {
    this.submittingState.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.updateComment(commentId, body),
      );
      this.patchComment(commentId, updated);
      return null;
    } catch {
      return 'แก้ไขคำตอบไม่สำเร็จ ลองใหม่อีกครั้ง';
    } finally {
      this.submittingState.set(false);
    }
  }

  async deleteComment(commentId: string): Promise<void> {
    const removed = this.commentState().filter(
      (comment) => comment.id === commentId || comment.parentId === commentId,
    );
    if (removed.length === 0) return;

    try {
      await firstValueFrom(this.api.deleteComment(commentId));
      // Replies go with their parent, exactly as the cascade does in the database.
      const removedIds = new Set(removed.map((comment) => comment.id));
      this.commentState.update((comments) =>
        comments.filter((comment) => !removedIds.has(comment.id)),
      );
      this.postState.update((post) =>
        post
          ? {
              ...post,
              commentCount: Math.max(post.commentCount - removed.length, 0),
              acceptedCommentId:
                post.acceptedCommentId && removedIds.has(post.acceptedCommentId)
                  ? null
                  : post.acceptedCommentId,
            }
          : post,
      );
    } catch {
      this.errorState.set('ลบคำตอบไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }

  async toggleAccepted(commentId: string): Promise<void> {
    try {
      const result = await firstValueFrom(this.api.acceptComment(commentId));
      this.postState.update((post) =>
        post ? { ...post, acceptedCommentId: result.acceptedCommentId } : post,
      );
      this.commentState.update((comments) =>
        comments.map((comment) => ({
          ...comment,
          isAccepted: comment.id === result.acceptedCommentId,
        })),
      );
    } catch {
      this.errorState.set('บันทึกคำตอบที่ยอมรับไม่สำเร็จ');
    }
  }

  async deletePost(): Promise<boolean> {
    const post = this.postState();
    if (!post) return false;

    try {
      await firstValueFrom(this.api.deletePost(post.id));
      return true;
    } catch {
      this.errorState.set('ลบกระทู้ไม่สำเร็จ ลองใหม่อีกครั้ง');
      return false;
    }
  }

  private patchComment(
    commentId: string,
    patch: Partial<CommunityComment>,
  ): void {
    this.commentState.update((comments) =>
      comments.map((comment) =>
        comment.id === commentId ? { ...comment, ...patch } : comment,
      ),
    );
  }
}

function byOldestFirst(left: CommunityComment, right: CommunityComment): number {
  return left.createdAt.localeCompare(right.createdAt);
}
