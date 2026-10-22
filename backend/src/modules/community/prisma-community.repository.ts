import { Injectable } from '@nestjs/common';

import type { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CommunityAuthor,
  CommunityComment,
  CommunityCommentRepository,
  CommunityPost,
  CommunityPostKind,
  CommunityPostRepository,
  CommunityPostStatus,
  CommunityTag,
  CommunityTagRepository,
  CommunityVoteRepository,
  CreateCommunityCommentInput,
  CreateCommunityPostInput,
  ListCommunityPostsQuery,
  StoredVoteValue,
  UpdateCommunityPostInput,
  VoteMap,
} from './community.repository';

const AUTHOR_SELECT = { id: true, username: true } as const;

const TAG_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  postCount: true,
} as const;

const POST_INCLUDE = {
  author: { select: AUTHOR_SELECT },
  tags: { select: { tag: { select: TAG_SELECT } } },
} as const;

const COMMENT_INCLUDE = {
  author: { select: AUTHOR_SELECT },
} as const;

interface PostRow {
  id: string;
  kind: string;
  title: string;
  slug: string;
  body: string;
  status: string;
  score: number;
  commentCount: number;
  viewCount: number;
  acceptedCommentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
  author: CommunityAuthor;
  tags: { tag: CommunityTag }[];
}

interface CommentRow {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  score: number;
  createdAt: Date;
  updatedAt: Date;
  author: CommunityAuthor;
}

function toPost(row: PostRow): CommunityPost {
  return {
    id: row.id,
    // The database CHECK constraint is what actually restricts these, so the
    // cast states a guarantee the schema already enforces.
    kind: row.kind as CommunityPostKind,
    title: row.title,
    slug: row.slug,
    body: row.body,
    status: row.status as CommunityPostStatus,
    score: row.score,
    commentCount: row.commentCount,
    viewCount: row.viewCount,
    acceptedCommentId: row.acceptedCommentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivityAt: row.lastActivityAt,
    author: row.author,
    tags: row.tags.map((entry) => entry.tag),
  };
}

function toComment(row: CommentRow): CommunityComment {
  return {
    id: row.id,
    postId: row.postId,
    parentId: row.parentId,
    body: row.body,
    score: row.score,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: row.author,
  };
}

@Injectable()
export class PrismaCommunityTagRepository extends CommunityTagRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  list(): Promise<CommunityTag[]> {
    return this.prisma.db.communityTag.findMany({
      orderBy: [{ postCount: 'desc' }, { slug: 'asc' }],
      select: TAG_SELECT,
    });
  }

  findBySlugs(slugs: string[]): Promise<CommunityTag[]> {
    if (slugs.length === 0) return Promise.resolve([]);
    return this.prisma.db.communityTag.findMany({
      where: { slug: { in: slugs } },
      select: TAG_SELECT,
    });
  }
}

@Injectable()
export class PrismaCommunityPostRepository extends CommunityPostRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(query: ListCommunityPostsQuery): Promise<CommunityPost[]> {
    const rows = await this.prisma.db.communityPost.findMany({
      where: {
        status: 'published',
        ...(query.authorId ? { authorId: query.authorId } : {}),
        ...(query.tagSlug
          ? { tags: { some: { tag: { slug: query.tagSlug } } } }
          : {}),
        ...(query.search ? searchFilter(query.search) : {}),
        ...(query.cursor ? { OR: cursorFilter(query.sort, query.cursor) } : {}),
      },
      orderBy: orderFor(query.sort),
      take: query.limit,
      include: POST_INCLUDE,
    });

    return rows.map(toPost);
  }

  async findById(postId: string): Promise<CommunityPost | null> {
    const row = await this.prisma.db.communityPost.findUnique({
      where: { id: postId },
      include: POST_INCLUDE,
    });
    return row ? toPost(row) : null;
  }

  async findBySlug(slug: string): Promise<CommunityPost | null> {
    const row = await this.prisma.db.communityPost.findUnique({
      where: { slug },
      include: POST_INCLUDE,
    });
    return row ? toPost(row) : null;
  }

  async slugExists(slug: string): Promise<boolean> {
    const row = await this.prisma.db.communityPost.findUnique({
      where: { slug },
      select: { id: true },
    });
    return row !== null;
  }

  async create(input: CreateCommunityPostInput): Promise<CommunityPost> {
    const row = await this.prisma.db.communityPost.create({
      data: {
        authorId: input.authorId,
        kind: input.kind,
        title: input.title,
        slug: input.slug,
        body: input.body,
        tags: { create: input.tagIds.map((tagId) => ({ tagId })) },
      },
      include: POST_INCLUDE,
    });
    return toPost(row);
  }

  async update(
    postId: string,
    input: UpdateCommunityPostInput,
  ): Promise<CommunityPost> {
    // Tags are replaced wholesale rather than diffed: the set is at most five
    // rows, and a delete-then-insert keeps the tag counter trigger honest.
    //
    // Transactions use the primary even when ordinary reads use a replica. The
    // replica extension changes the generated overload types, not this API.
    const database = this.prisma.db as Pick<PrismaClient, '$transaction'>;
    const row = await database.$transaction(async (tx) => {
      if (input.tagIds) {
        await tx.communityPostTag.deleteMany({ where: { postId } });
        await tx.communityPostTag.createMany({
          data: input.tagIds.map((tagId) => ({ postId, tagId })),
        });
      }

      return tx.communityPost.update({
        where: { id: postId },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(input.kind === undefined ? {} : { kind: input.kind }),
        },
        include: POST_INCLUDE,
      });
    });

    return toPost(row);
  }

  async delete(postId: string): Promise<void> {
    await this.prisma.db.communityPost.delete({ where: { id: postId } });
  }

  async setAcceptedComment(
    postId: string,
    commentId: string | null,
  ): Promise<void> {
    await this.prisma.db.communityPost.update({
      where: { id: postId },
      data: { acceptedCommentId: commentId },
    });
  }

  async incrementViewCount(postId: string): Promise<void> {
    await this.prisma.db.communityPost.update({
      where: { id: postId },
      data: { viewCount: { increment: 1 } },
    });
  }

  countByAuthorSince(authorId: string, since: Date): Promise<number> {
    return this.prisma.db.communityPost.count({
      where: { authorId, createdAt: { gte: since } },
    });
  }
}

/**
 * Substring search, deliberately not full-text.
 *
 * Postgres' `simple` text search configuration splits on whitespace, and Thai is
 * written without spaces between words, so a tsvector index would never match a
 * Thai query. ILIKE does, at the cost of a sequential scan; revisit with pgroonga
 * or pg_bigm when the table outgrows it.
 */
function searchFilter(search: string) {
  return {
    OR: [
      { title: { contains: search, mode: 'insensitive' as const } },
      { body: { contains: search, mode: 'insensitive' as const } },
    ],
  };
}

function orderFor(sort: ListCommunityPostsQuery['sort']) {
  switch (sort) {
    case 'top':
      return [{ score: 'desc' as const }, { id: 'desc' as const }];
    case 'active':
      return [{ lastActivityAt: 'desc' as const }, { id: 'desc' as const }];
    default:
      return [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
  }
}

/**
 * The keyset predicate: strictly past the cursor row in the current order.
 *
 * Expressed as two branches because Prisma has no row-value comparison. The
 * second branch is what makes ties (two posts on the same score) paginate
 * without repeating or skipping rows.
 */
function cursorFilter(
  sort: ListCommunityPostsQuery['sort'],
  cursor: { value: number; id: string },
) {
  const id = { id: { lt: cursor.id } };

  switch (sort) {
    case 'top':
      return [{ score: { lt: cursor.value } }, { score: cursor.value, ...id }];
    case 'active': {
      const at = new Date(cursor.value);
      return [{ lastActivityAt: { lt: at } }, { lastActivityAt: at, ...id }];
    }
    default: {
      const at = new Date(cursor.value);
      return [{ createdAt: { lt: at } }, { createdAt: at, ...id }];
    }
  }
}

@Injectable()
export class PrismaCommunityCommentRepository extends CommunityCommentRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listForPost(postId: string): Promise<CommunityComment[]> {
    const rows = await this.prisma.db.communityComment.findMany({
      where: { postId },
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
      include: COMMENT_INCLUDE,
    });
    return rows.map(toComment);
  }

  async findById(commentId: string): Promise<CommunityComment | null> {
    const row = await this.prisma.db.communityComment.findUnique({
      where: { id: commentId },
      include: COMMENT_INCLUDE,
    });
    return row ? toComment(row) : null;
  }

  async create(input: CreateCommunityCommentInput): Promise<CommunityComment> {
    const row = await this.prisma.db.communityComment.create({
      data: {
        postId: input.postId,
        authorId: input.authorId,
        parentId: input.parentId,
        body: input.body,
      },
      include: COMMENT_INCLUDE,
    });
    return toComment(row);
  }

  async updateBody(commentId: string, body: string): Promise<CommunityComment> {
    const row = await this.prisma.db.communityComment.update({
      where: { id: commentId },
      data: { body },
      include: COMMENT_INCLUDE,
    });
    return toComment(row);
  }

  async delete(commentId: string): Promise<void> {
    await this.prisma.db.communityComment.delete({ where: { id: commentId } });
  }
}

@Injectable()
export class PrismaCommunityVoteRepository extends CommunityVoteRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async setPostVote(
    userId: string,
    postId: string,
    value: StoredVoteValue | null,
  ): Promise<void> {
    if (value === null) {
      await this.prisma.db.communityVote.deleteMany({
        where: { userId, postId },
      });
      return;
    }

    await this.prisma.db.communityVote.upsert({
      where: { userId_postId: { userId, postId } },
      create: { userId, postId, value },
      update: { value },
    });
  }

  async setCommentVote(
    userId: string,
    commentId: string,
    value: StoredVoteValue | null,
  ): Promise<void> {
    if (value === null) {
      await this.prisma.db.communityVote.deleteMany({
        where: { userId, commentId },
      });
      return;
    }

    await this.prisma.db.communityVote.upsert({
      where: { userId_commentId: { userId, commentId } },
      create: { userId, commentId, value },
      update: { value },
    });
  }

  async findPostVotes(userId: string, postIds: string[]): Promise<VoteMap> {
    if (postIds.length === 0) return new Map();

    const rows = await this.prisma.db.communityVote.findMany({
      where: { userId, postId: { in: postIds } },
      select: { postId: true, value: true },
    });

    return new Map(
      rows
        .filter(
          (row): row is { postId: string; value: number } =>
            row.postId !== null,
        )
        .map((row) => [row.postId, row.value as StoredVoteValue]),
    );
  }

  async findCommentVotes(
    userId: string,
    commentIds: string[],
  ): Promise<VoteMap> {
    if (commentIds.length === 0) return new Map();

    const rows = await this.prisma.db.communityVote.findMany({
      where: { userId, commentId: { in: commentIds } },
      select: { commentId: true, value: true },
    });

    return new Map(
      rows
        .filter(
          (row): row is { commentId: string; value: number } =>
            row.commentId !== null,
        )
        .map((row) => [row.commentId, row.value as StoredVoteValue]),
    );
  }
}
