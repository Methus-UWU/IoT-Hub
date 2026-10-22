import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AuthorizationService } from '../authorization/authorization.service';
import {
  CommunityComment,
  CommunityCommentRepository,
  CommunityPost,
  CommunityVoteRepository,
  StoredVoteValue,
  VoteMap,
} from './community.repository';
import { CommunityCommentsService } from './community-comments.service';
import { CommunityPostsService } from './community-posts.service';

const POST_ID = 'post-1';
const OTHER_POST_ID = 'post-2';
const ASKER = 'user-asker';
const ANSWERER = 'user-answerer';

function post(overrides: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id: POST_ID,
    kind: 'question',
    title: 'ESP32 keeps rebooting after deep sleep',
    slug: 'esp32-keeps-rebooting-abcd1234',
    body: 'It reboots as soon as it wakes up.',
    status: 'published',
    score: 0,
    commentCount: 0,
    viewCount: 0,
    acceptedCommentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActivityAt: new Date(),
    author: { id: ASKER, username: 'asker' },
    tags: [],
    ...overrides,
  };
}

class FakeCommentRepository extends CommunityCommentRepository {
  readonly rows = new Map<string, CommunityComment>();
  private sequence = 0;

  seed(comment: CommunityComment): CommunityComment {
    this.rows.set(comment.id, comment);
    return comment;
  }

  listForPost(postId: string): Promise<CommunityComment[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.postId === postId),
    );
  }

  findById(commentId: string): Promise<CommunityComment | null> {
    return Promise.resolve(this.rows.get(commentId) ?? null);
  }

  create(input: {
    postId: string;
    authorId: string;
    parentId: string | null;
    body: string;
  }): Promise<CommunityComment> {
    const comment: CommunityComment = {
      id: `comment-${++this.sequence}`,
      postId: input.postId,
      parentId: input.parentId,
      body: input.body,
      score: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      author: { id: input.authorId, username: 'answerer' },
    };
    this.rows.set(comment.id, comment);
    return Promise.resolve(comment);
  }

  updateBody(commentId: string, body: string): Promise<CommunityComment> {
    const existing = this.rows.get(commentId)!;
    const updated = { ...existing, body };
    this.rows.set(commentId, updated);
    return Promise.resolve(updated);
  }

  delete(commentId: string): Promise<void> {
    this.rows.delete(commentId);
    return Promise.resolve();
  }
}

class FakeVoteRepository extends CommunityVoteRepository {
  setPostVote(): Promise<void> {
    return Promise.resolve();
  }

  setCommentVote(): Promise<void> {
    return Promise.resolve();
  }

  findPostVotes(): Promise<VoteMap> {
    return Promise.resolve(new Map<string, StoredVoteValue>());
  }

  findCommentVotes(): Promise<VoteMap> {
    return Promise.resolve(new Map<string, StoredVoteValue>());
  }
}

describe('CommunityCommentsService', () => {
  let comments: FakeCommentRepository;
  let service: CommunityCommentsService;
  let accepted: string | null;
  let current: CommunityPost;

  beforeEach(() => {
    comments = new FakeCommentRepository();
    accepted = null;
    current = post();

    const posts = {
      requireExisting: (postId: string) =>
        Promise.resolve(
          postId === POST_ID
            ? { ...current, acceptedCommentId: accepted }
            : post({ id: OTHER_POST_ID }),
        ),
      requireAuthor: (userId: string, postId: string) => {
        if (userId !== ASKER) {
          return Promise.reject(new ForbiddenException());
        }
        return Promise.resolve({
          ...post({ id: postId }),
          acceptedCommentId: accepted,
        });
      },
      setAcceptedComment: (_postId: string, commentId: string | null) => {
        accepted = commentId;
        return Promise.resolve();
      },
    } as unknown as CommunityPostsService;

    const authorization = {
      requireActiveAccount: () => Promise.resolve(),
      isPlatformAdmin: () => Promise.resolve(false),
    } as unknown as AuthorizationService;

    service = new CommunityCommentsService(
      comments,
      new FakeVoteRepository(),
      posts,
      authorization,
    );
  });

  it('refuses a reply to a reply', async () => {
    const answer = await service.create(
      ANSWERER,
      POST_ID,
      'Try a pull-up.',
      null,
    );
    const reply = await service.create(ASKER, POST_ID, 'Which pin?', answer.id);

    await expect(
      service.create(ANSWERER, POST_ID, 'GPIO23.', reply.id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a parent that belongs to another post', async () => {
    comments.seed({
      id: 'foreign-comment',
      postId: OTHER_POST_ID,
      parentId: null,
      body: 'Answer on a different question',
      score: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      author: { id: ANSWERER, username: 'answerer' },
    });

    await expect(
      service.create(ASKER, POST_ID, 'Reply', 'foreign-comment'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets only the asker accept an answer', async () => {
    const answer = await service.create(
      ANSWERER,
      POST_ID,
      'Use a pull-up.',
      null,
    );

    await expect(
      service.setAccepted(ANSWERER, answer.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(service.setAccepted(ASKER, answer.id)).resolves.toEqual({
      acceptedCommentId: answer.id,
    });
  });

  it('clears the acceptance when the same answer is accepted twice', async () => {
    const answer = await service.create(
      ANSWERER,
      POST_ID,
      'Use a pull-up.',
      null,
    );

    await service.setAccepted(ASKER, answer.id);

    await expect(service.setAccepted(ASKER, answer.id)).resolves.toEqual({
      acceptedCommentId: null,
    });
  });

  it('refuses to accept a reply rather than an answer', async () => {
    const answer = await service.create(
      ANSWERER,
      POST_ID,
      'Use a pull-up.',
      null,
    );
    const reply = await service.create(ASKER, POST_ID, 'Which pin?', answer.id);

    await expect(service.setAccepted(ASKER, reply.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a deletion by anyone but the author or an admin', async () => {
    const answer = await service.create(
      ANSWERER,
      POST_ID,
      'Use a pull-up.',
      null,
    );

    await expect(service.remove(ASKER, answer.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    await expect(service.remove(ANSWERER, answer.id)).resolves.toBeUndefined();
  });
});
