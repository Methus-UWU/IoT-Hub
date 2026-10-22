import { CommunityPost } from './community.repository';
import { decodeFeedCursor, encodeFeedCursor } from './feed-cursor';

const POST: CommunityPost = {
  id: 'f7d2c0d6-4a2b-4e63-9a6d-1f4c1b0f2f10',
  kind: 'question',
  title: 'ESP32 keeps rebooting',
  slug: 'esp32-keeps-rebooting-abcd1234',
  body: 'body',
  status: 'published',
  score: 7,
  commentCount: 2,
  viewCount: 30,
  acceptedCommentId: null,
  createdAt: new Date('2026-09-01T10:00:00.000Z'),
  updatedAt: new Date('2026-09-02T10:00:00.000Z'),
  lastActivityAt: new Date('2026-09-03T10:00:00.000Z'),
  author: { id: 'user-1', username: 'somchai' },
  tags: [],
};

describe('feed cursor', () => {
  it('carries the score when sorting by top', () => {
    expect(decodeFeedCursor(encodeFeedCursor('top', POST))).toEqual({
      value: 7,
      id: POST.id,
    });
  });

  it('carries the creation time when sorting by new', () => {
    expect(decodeFeedCursor(encodeFeedCursor('new', POST))).toEqual({
      value: POST.createdAt.getTime(),
      id: POST.id,
    });
  });

  it('carries the activity time when sorting by active', () => {
    expect(decodeFeedCursor(encodeFeedCursor('active', POST))).toEqual({
      value: POST.lastActivityAt.getTime(),
      id: POST.id,
    });
  });

  it('returns null for a cursor it did not produce', () => {
    expect(decodeFeedCursor('not-a-cursor')).toBeNull();
    expect(decodeFeedCursor('')).toBeNull();
  });
});
