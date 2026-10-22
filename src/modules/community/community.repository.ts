/**
 * Persistence contracts for the community feed.
 *
 * Split by aggregate rather than by table: posts, comments, votes, and the tag
 * catalog are each asked for as a unit, and the services never join them by hand.
 *
 * Counters (`score`, `commentCount`, `postCount`) are maintained by database
 * triggers — see the community migration. Nothing here writes them, and a
 * repository that returned a computed score would be reading a different number
 * from the one the feed sorts on.
 *
 * See docs/adr/ADR-001-database-access.md.
 */

export type CommunityPostKind = 'question' | 'discussion' | 'showcase';
export type CommunityPostStatus = 'published' | 'hidden';
export type CommunityPostSort = 'new' | 'top' | 'active';

/** Stored values only. A cleared vote is the absence of a row, never a zero. */
export type StoredVoteValue = -1 | 1;

export interface CommunityAuthor {
  id: string;
  username: string;
}

export interface CommunityTag {
  id: string;
  slug: string;
  name: string;
  description: string;
  postCount: number;
}

export interface CommunityPost {
  id: string;
  kind: CommunityPostKind;
  title: string;
  slug: string;
  body: string;
  status: CommunityPostStatus;
  score: number;
  commentCount: number;
  viewCount: number;
  acceptedCommentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
  author: CommunityAuthor;
  tags: CommunityTag[];
}

export interface CreateCommunityPostInput {
  authorId: string;
  kind: CommunityPostKind;
  title: string;
  slug: string;
  body: string;
  tagIds: string[];
}

export interface UpdateCommunityPostInput {
  title?: string;
  body?: string;
  kind?: CommunityPostKind;
  tagIds?: string[];
}

/**
 * One page of the feed.
 *
 * `cursor` is keyset, not an offset: the caller hands back the last row's sort
 * value and id, so a page stays stable while new posts arrive above it.
 */
export interface ListCommunityPostsQuery {
  sort: CommunityPostSort;
  limit: number;
  tagSlug?: string;
  authorId?: string;
  search?: string;
  cursor?: CommunityPostCursor;
}

export interface CommunityPostCursor {
  /** The sort column's value on the last row of the previous page. */
  value: number;
  id: string;
}

export interface CommunityComment {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  score: number;
  createdAt: Date;
  updatedAt: Date;
  author: CommunityAuthor;
}

export interface CreateCommunityCommentInput {
  postId: string;
  authorId: string;
  parentId: string | null;
  body: string;
}

/** Which way one user voted on a set of posts or comments. */
export type VoteMap = ReadonlyMap<string, StoredVoteValue>;

export abstract class CommunityTagRepository {
  abstract list(): Promise<CommunityTag[]>;

  /** Returns only the tags that exist, so the caller can reject unknown slugs. */
  abstract findBySlugs(slugs: string[]): Promise<CommunityTag[]>;
}

export abstract class CommunityPostRepository {
  abstract list(query: ListCommunityPostsQuery): Promise<CommunityPost[]>;

  abstract findById(postId: string): Promise<CommunityPost | null>;

  abstract findBySlug(slug: string): Promise<CommunityPost | null>;

  abstract slugExists(slug: string): Promise<boolean>;

  abstract create(input: CreateCommunityPostInput): Promise<CommunityPost>;

  abstract update(
    postId: string,
    input: UpdateCommunityPostInput,
  ): Promise<CommunityPost>;

  abstract delete(postId: string): Promise<void>;

  /** Null clears the acceptance. */
  abstract setAcceptedComment(
    postId: string,
    commentId: string | null,
  ): Promise<void>;

  abstract incrementViewCount(postId: string): Promise<void>;

  abstract countByAuthorSince(authorId: string, since: Date): Promise<number>;
}

export abstract class CommunityCommentRepository {
  abstract listForPost(postId: string): Promise<CommunityComment[]>;

  abstract findById(commentId: string): Promise<CommunityComment | null>;

  abstract create(
    input: CreateCommunityCommentInput,
  ): Promise<CommunityComment>;

  abstract updateBody(
    commentId: string,
    body: string,
  ): Promise<CommunityComment>;

  abstract delete(commentId: string): Promise<void>;
}

export abstract class CommunityVoteRepository {
  /** Upserts to `value`, or removes the row when the user withdraws the vote. */
  abstract setPostVote(
    userId: string,
    postId: string,
    value: StoredVoteValue | null,
  ): Promise<void>;

  abstract setCommentVote(
    userId: string,
    commentId: string,
    value: StoredVoteValue | null,
  ): Promise<void>;

  abstract findPostVotes(userId: string, postIds: string[]): Promise<VoteMap>;

  abstract findCommentVotes(
    userId: string,
    commentIds: string[],
  ): Promise<VoteMap>;
}
