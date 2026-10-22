import { Injectable } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import {
  CommunityCommentRepository,
  CommunityPostRepository,
  CommunityVoteRepository,
  StoredVoteValue,
} from './community.repository';
import { CommunityCommentsService } from './community-comments.service';
import { CommunityPostsService } from './community-posts.service';

export interface VoteResult {
  score: number;
  viewerVote: number;
}

/**
 * Votes on posts and answers.
 *
 * The score itself is never written here. A database trigger applies the delta
 * when the vote row changes, so the number stays correct on paths this service
 * never sees — a cascade delete when an account is removed, for one. This
 * service reads the score back afterwards rather than predicting it.
 */
@Injectable()
export class CommunityVotesService {
  constructor(
    private readonly votes: CommunityVoteRepository,
    private readonly postRows: CommunityPostRepository,
    private readonly commentRows: CommunityCommentRepository,
    private readonly posts: CommunityPostsService,
    private readonly comments: CommunityCommentsService,
    private readonly authorization: AuthorizationService,
  ) {}

  async votePost(
    userId: string,
    postId: string,
    value: -1 | 0 | 1,
  ): Promise<VoteResult> {
    await this.authorization.requireActiveAccount(userId);
    await this.posts.requireExisting(postId);

    await this.votes.setPostVote(userId, postId, stored(value));

    const post = await this.postRows.findById(postId);
    return { score: post?.score ?? 0, viewerVote: value };
  }

  async voteComment(
    userId: string,
    commentId: string,
    value: -1 | 0 | 1,
  ): Promise<VoteResult> {
    await this.authorization.requireActiveAccount(userId);
    await this.comments.requireExisting(commentId);

    await this.votes.setCommentVote(userId, commentId, stored(value));

    const comment = await this.commentRows.findById(commentId);
    return { score: comment?.score ?? 0, viewerVote: value };
  }
}

/** 0 means "withdraw", which is the absence of a row rather than a stored zero. */
function stored(value: -1 | 0 | 1): StoredVoteValue | null {
  return value === 0 ? null : value;
}
