import {
  CommunityComment,
  CommunityPost,
  CommunityPostKind,
  CommunityTag,
  VoteMap,
} from './community.repository';

/** How much of a body the feed carries. Full bodies belong to the detail page. */
const EXCERPT_LENGTH = 280;
const MARKDOWN_PREVIEW_LENGTH = 1200;

export interface CommunityTagView {
  slug: string;
  name: string;
  description: string;
  postCount: number;
}

export interface CommunityPostSummaryView {
  id: string;
  kind: CommunityPostKind;
  title: string;
  slug: string;
  excerpt: string;
  markdownPreview: string;
  markdownPreviewTruncated: boolean;
  score: number;
  commentCount: number;
  viewCount: number;
  hasAcceptedAnswer: boolean;
  createdAt: string;
  lastActivityAt: string;
  author: { id: string; username: string };
  tags: CommunityTagView[];
  /** How the caller voted: -1, 0, or 1. Always 0 for an anonymous reader. */
  viewerVote: number;
  /** Whether the caller may edit or delete this post. UX only; the API re-checks. */
  viewerIsAuthor: boolean;
}

export interface CommunityPostDetailView extends CommunityPostSummaryView {
  body: string;
  acceptedCommentId: string | null;
  updatedAt: string;
}

export interface CommunityCommentView {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  score: number;
  createdAt: string;
  updatedAt: string;
  author: { id: string; username: string };
  isAccepted: boolean;
  viewerVote: number;
  viewerIsAuthor: boolean;
}

export function toTagView(tag: CommunityTag): CommunityTagView {
  return {
    slug: tag.slug,
    name: tag.name,
    description: tag.description,
    postCount: tag.postCount,
  };
}

export function toPostSummary(
  post: CommunityPost,
  viewerId: string | null,
  votes: VoteMap,
): CommunityPostSummaryView {
  return {
    id: post.id,
    kind: post.kind,
    title: post.title,
    slug: post.slug,
    excerpt: buildExcerpt(post.body),
    markdownPreview: post.body.slice(0, MARKDOWN_PREVIEW_LENGTH),
    markdownPreviewTruncated: post.body.length > MARKDOWN_PREVIEW_LENGTH,
    score: post.score,
    commentCount: post.commentCount,
    viewCount: post.viewCount,
    hasAcceptedAnswer: post.acceptedCommentId !== null,
    createdAt: post.createdAt.toISOString(),
    lastActivityAt: post.lastActivityAt.toISOString(),
    author: post.author,
    tags: post.tags.map(toTagView),
    viewerVote: votes.get(post.id) ?? 0,
    viewerIsAuthor: viewerId !== null && viewerId === post.author.id,
  };
}

export function toPostDetail(
  post: CommunityPost,
  viewerId: string | null,
  votes: VoteMap,
): CommunityPostDetailView {
  return {
    ...toPostSummary(post, viewerId, votes),
    body: post.body,
    acceptedCommentId: post.acceptedCommentId,
    updatedAt: post.updatedAt.toISOString(),
  };
}

export function toCommentView(
  comment: CommunityComment,
  viewerId: string | null,
  votes: VoteMap,
  acceptedCommentId: string | null,
): CommunityCommentView {
  return {
    id: comment.id,
    postId: comment.postId,
    parentId: comment.parentId,
    body: comment.body,
    score: comment.score,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    author: comment.author,
    isAccepted: acceptedCommentId === comment.id,
    viewerVote: votes.get(comment.id) ?? 0,
    viewerIsAuthor: viewerId !== null && viewerId === comment.author.id,
  };
}

/**
 * A plain-text preview of a Markdown body.
 *
 * Only the markers that would read as noise in a one-line card are removed —
 * fences, heading hashes, emphasis, and link syntax. This is a display helper,
 * never a sanitizer: the client renders Markdown through its own sanitizing
 * pipe, and nothing here may be relied on for safety.
 */
function buildExcerpt(body: string): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return plain.length > EXCERPT_LENGTH
    ? `${plain.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : plain;
}
