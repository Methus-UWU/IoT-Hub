import {
  CommunityPost,
  CommunityPostCursor,
  CommunityPostSort,
} from './community.repository';

/**
 * Keyset cursors for the feed.
 *
 * The cursor carries the sort column's value plus the row id, which is what lets
 * a page stay correct while posts are being created and voted on above it: an
 * offset would repeat or skip rows every time the set shifted.
 *
 * It is opaque on purpose — the encoding is an implementation detail, and a
 * client that parsed it would pin us to this sort scheme. It carries no secret,
 * so it is encoded rather than signed.
 */
export function encodeFeedCursor(
  sort: CommunityPostSort,
  post: CommunityPost,
): string {
  return Buffer.from(`${sortValue(sort, post)}:${post.id}`, 'utf8').toString(
    'base64url',
  );
}

/** Returns null for anything malformed; a bad cursor restarts the feed. */
export function decodeFeedCursor(raw: string): CommunityPostCursor | null {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator <= 0) return null;

  const value = Number(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (!Number.isFinite(value) || !id) return null;

  return { value, id };
}

function sortValue(sort: CommunityPostSort, post: CommunityPost): number {
  switch (sort) {
    case 'top':
      return post.score;
    case 'active':
      return post.lastActivityAt.getTime();
    default:
      return post.createdAt.getTime();
  }
}
