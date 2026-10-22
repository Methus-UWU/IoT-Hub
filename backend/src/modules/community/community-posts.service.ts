import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import {
  CommunityPost,
  CommunityPostRepository,
  CommunityPostSort,
  CommunityTagRepository,
  CommunityVoteRepository,
} from './community.repository';
import {
  CommunityPostDetailView,
  CommunityPostSummaryView,
  CommunityTagView,
  toPostDetail,
  toPostSummary,
  toTagView,
} from './community.mapper';
import {
  CreateCommunityPostDto,
  ListCommunityPostsDto,
  UpdateCommunityPostDto,
} from './dto/community.dto';
import { decodeFeedCursor, encodeFeedCursor } from './feed-cursor';
import { buildPostSlug } from './post-slug';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Posting ceiling per author per rolling day.
 *
 * The global throttler already limits requests per minute; this limits the
 * damage a patient spammer can do over a day, which a per-minute rule does not.
 */
const MAX_POSTS_PER_DAY = 15;
const DAY_MS = 86_400_000;

export interface CommunityFeedPage {
  data: CommunityPostSummaryView[];
  meta: { nextCursor: string | null };
}

/**
 * Community posts.
 *
 * Reads are public, so every method takes `viewerId: string | null` rather than
 * assuming an identity. The viewer only ever changes what the response says
 * about the caller — their own vote, whether they may edit — never which rows
 * come back.
 */
@Injectable()
export class CommunityPostsService {
  constructor(
    private readonly posts: CommunityPostRepository,
    private readonly tags: CommunityTagRepository,
    private readonly votes: CommunityVoteRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  async listTags(): Promise<CommunityTagView[]> {
    const tags = await this.tags.list();
    return tags.map(toTagView);
  }

  async list(
    query: ListCommunityPostsDto,
    viewerId: string | null,
  ): Promise<CommunityFeedPage> {
    const sort: CommunityPostSort = query.sort ?? 'new';
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const posts = await this.posts.list({
      sort,
      limit,
      tagSlug: query.tag,
      authorId: query.authorId,
      search: query.q || undefined,
      // A cursor that does not decode restarts the feed rather than 400ing: it
      // is opaque to the client, so a stale one is our problem, not theirs.
      cursor: query.cursor
        ? (decodeFeedCursor(query.cursor) ?? undefined)
        : undefined,
    });

    const viewerVotes = viewerId
      ? await this.votes.findPostVotes(
          viewerId,
          posts.map((post) => post.id),
        )
      : new Map();

    const last = posts.at(-1);
    return {
      data: posts.map((post) => toPostSummary(post, viewerId, viewerVotes)),
      meta: {
        // A short page is the last page; asking for one more row just to learn
        // that costs a read on every page.
        nextCursor:
          posts.length === limit && last ? encodeFeedCursor(sort, last) : null,
      },
    };
  }

  async getBySlug(
    slug: string,
    viewerId: string | null,
  ): Promise<CommunityPostDetailView> {
    const post = await this.posts.findBySlug(slug);
    if (!post || post.status !== 'published') {
      throw new NotFoundException({
        code: 'COMMUNITY_POST_NOT_FOUND',
        message: 'Post not found',
      });
    }

    // Best-effort: a failed counter must not fail the page.
    void this.posts.incrementViewCount(post.id).catch(() => undefined);

    return this.detailFor(post, viewerId);
  }

  async create(
    userId: string,
    dto: CreateCommunityPostDto,
  ): Promise<CommunityPostDetailView> {
    await this.authorization.requireActiveAccount(userId);
    await this.assertUnderDailyLimit(userId);

    const tagIds = await this.resolveTagIds(dto.tags);

    const post = await this.posts.create({
      authorId: userId,
      kind: dto.kind ?? 'question',
      title: dto.title,
      slug: buildPostSlug(dto.title),
      body: dto.body,
      tagIds,
    });

    return this.detailFor(post, userId);
  }

  async update(
    userId: string,
    postId: string,
    dto: UpdateCommunityPostDto,
  ): Promise<CommunityPostDetailView> {
    await this.requireAuthor(userId, postId);

    const tagIds = dto.tags ? await this.resolveTagIds(dto.tags) : undefined;

    const post = await this.posts.update(postId, {
      title: dto.title,
      body: dto.body,
      kind: dto.kind,
      tagIds,
    });

    return this.detailFor(post, userId);
  }

  /** The author may delete their own post; a platform admin may delete any. */
  async remove(userId: string, postId: string): Promise<void> {
    const post = await this.requireExisting(postId);

    if (post.author.id !== userId) {
      const isAdmin = await this.authorization.isPlatformAdmin(userId);
      if (!isAdmin) {
        throw new ForbiddenException({
          code: 'COMMUNITY_POST_NOT_OWNED',
          message: 'Only the author can change this post',
        });
      }
    }

    await this.posts.delete(postId);
  }

  /** Shared by the comments service, which must not reach into the repository. */
  async requireExisting(postId: string): Promise<CommunityPost> {
    const post = await this.posts.findById(postId);
    if (!post) {
      throw new NotFoundException({
        code: 'COMMUNITY_POST_NOT_FOUND',
        message: 'Post not found',
      });
    }
    return post;
  }

  async requireAuthor(userId: string, postId: string): Promise<CommunityPost> {
    const post = await this.requireExisting(postId);
    if (post.author.id !== userId) {
      throw new ForbiddenException({
        code: 'COMMUNITY_POST_NOT_OWNED',
        message: 'Only the author can change this post',
      });
    }
    return post;
  }

  async setAcceptedComment(
    postId: string,
    commentId: string | null,
  ): Promise<void> {
    await this.posts.setAcceptedComment(postId, commentId);
  }

  private async detailFor(
    post: CommunityPost,
    viewerId: string | null,
  ): Promise<CommunityPostDetailView> {
    const votes = viewerId
      ? await this.votes.findPostVotes(viewerId, [post.id])
      : new Map();
    return toPostDetail(post, viewerId, votes);
  }

  /** Rejects the whole request if any slug is outside the curated catalog. */
  private async resolveTagIds(slugs: string[]): Promise<string[]> {
    const tags = await this.tags.findBySlugs(slugs);

    if (tags.length !== slugs.length) {
      const known = new Set(tags.map((tag) => tag.slug));
      throw new BadRequestException({
        code: 'COMMUNITY_TAG_UNKNOWN',
        message: 'One or more tags do not exist',
        tags: slugs.filter((slug) => !known.has(slug)),
      });
    }

    return tags.map((tag) => tag.id);
  }

  private async assertUnderDailyLimit(userId: string): Promise<void> {
    const since = new Date(Date.now() - DAY_MS);
    const used = await this.posts.countByAuthorSince(userId, since);

    if (used >= MAX_POSTS_PER_DAY) {
      throw new ForbiddenException({
        code: 'COMMUNITY_POST_LIMIT_REACHED',
        message: 'Daily post limit reached',
        limit: MAX_POSTS_PER_DAY,
        used,
      });
    }
  }
}
