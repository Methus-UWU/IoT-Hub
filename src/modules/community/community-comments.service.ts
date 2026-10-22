import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import {
  CommunityComment,
  CommunityCommentRepository,
  CommunityVoteRepository,
} from './community.repository';
import { CommunityCommentView, toCommentView } from './community.mapper';
import { CommunityPostsService } from './community-posts.service';

/**
 * Answers and replies.
 *
 * Threads are one level deep. Deeper nesting reads badly on a phone and makes
 * every list query a recursive one, so a reply to a reply is refused here rather
 * than flattened silently — the client shows the parent it will actually attach to.
 */
@Injectable()
export class CommunityCommentsService {
  constructor(
    private readonly comments: CommunityCommentRepository,
    private readonly votes: CommunityVoteRepository,
    private readonly posts: CommunityPostsService,
    private readonly authorization: AuthorizationService,
  ) {}

  async listForPost(
    postId: string,
    viewerId: string | null,
  ): Promise<CommunityCommentView[]> {
    const post = await this.posts.requireExisting(postId);
    const comments = await this.comments.listForPost(postId);

    const viewerVotes = viewerId
      ? await this.votes.findCommentVotes(
          viewerId,
          comments.map((comment) => comment.id),
        )
      : new Map();

    return comments.map((comment) =>
      toCommentView(comment, viewerId, viewerVotes, post.acceptedCommentId),
    );
  }

  async create(
    userId: string,
    postId: string,
    body: string,
    parentId: string | null,
  ): Promise<CommunityCommentView> {
    await this.authorization.requireActiveAccount(userId);
    const post = await this.posts.requireExisting(postId);

    if (post.status !== 'published') {
      throw new ForbiddenException({
        code: 'COMMUNITY_POST_CLOSED',
        message: 'This post is not accepting answers',
      });
    }

    if (parentId) await this.assertValidParent(postId, parentId);

    const comment = await this.comments.create({
      postId,
      authorId: userId,
      parentId,
      body,
    });

    return toCommentView(comment, userId, new Map(), post.acceptedCommentId);
  }

  async update(
    userId: string,
    commentId: string,
    body: string,
  ): Promise<CommunityCommentView> {
    const existing = await this.requireAuthor(userId, commentId);
    const updated = await this.comments.updateBody(commentId, body);
    const post = await this.posts.requireExisting(existing.postId);

    const votes = await this.votes.findCommentVotes(userId, [commentId]);
    return toCommentView(updated, userId, votes, post.acceptedCommentId);
  }

  /** The author may delete their own answer; a platform admin may delete any. */
  async remove(userId: string, commentId: string): Promise<void> {
    const comment = await this.requireExisting(commentId);

    if (comment.author.id !== userId) {
      const isAdmin = await this.authorization.isPlatformAdmin(userId);
      if (!isAdmin) {
        throw new ForbiddenException({
          code: 'COMMUNITY_COMMENT_NOT_OWNED',
          message: 'Only the author can change this answer',
        });
      }
    }

    await this.comments.delete(commentId);
  }

  /**
   * Marks an answer as the one that solved the question.
   *
   * Only the asker decides, and marking the already-accepted answer clears it,
   * so the same button toggles instead of needing a second endpoint.
   */
  async setAccepted(
    userId: string,
    commentId: string,
  ): Promise<{ acceptedCommentId: string | null }> {
    const comment = await this.requireExisting(commentId);
    const post = await this.posts.requireAuthor(userId, comment.postId);

    if (comment.parentId !== null) {
      throw new BadRequestException({
        code: 'COMMUNITY_REPLY_NOT_ACCEPTABLE',
        message: 'Only a top-level answer can be accepted',
      });
    }

    const next = post.acceptedCommentId === commentId ? null : commentId;
    await this.posts.setAcceptedComment(post.id, next);
    return { acceptedCommentId: next };
  }

  async requireExisting(commentId: string): Promise<CommunityComment> {
    const comment = await this.comments.findById(commentId);
    if (!comment) {
      throw new NotFoundException({
        code: 'COMMUNITY_COMMENT_NOT_FOUND',
        message: 'Answer not found',
      });
    }
    return comment;
  }

  private async requireAuthor(
    userId: string,
    commentId: string,
  ): Promise<CommunityComment> {
    const comment = await this.requireExisting(commentId);
    if (comment.author.id !== userId) {
      throw new ForbiddenException({
        code: 'COMMUNITY_COMMENT_NOT_OWNED',
        message: 'Only the author can change this answer',
      });
    }
    return comment;
  }

  private async assertValidParent(
    postId: string,
    parentId: string,
  ): Promise<void> {
    const parent = await this.requireExisting(parentId);

    // Without this check a reply could be attached to an answer on another
    // post, which would make it visible under a thread it was never written for.
    if (parent.postId !== postId) {
      throw new BadRequestException({
        code: 'COMMUNITY_PARENT_MISMATCH',
        message: 'The parent answer belongs to a different post',
      });
    }

    if (parent.parentId !== null) {
      throw new BadRequestException({
        code: 'COMMUNITY_REPLY_TOO_DEEP',
        message: 'Replies can only be one level deep',
      });
    }
  }
}
