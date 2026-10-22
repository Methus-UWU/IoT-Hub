import { HttpClient, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';

export type CommunityPostKind = 'question' | 'discussion' | 'showcase';
export type CommunityFeedSort = 'new' | 'top' | 'active';
/** -1, 0, or 1. 0 means the viewer has no vote, or withdrew it. */
export type VoteValue = -1 | 0 | 1;

export interface CommunityAuthor {
  id: string;
  username: string;
}

export interface CommunityTag {
  slug: string;
  name: string;
  description: string;
  postCount: number;
}

export interface CommunityPostSummary {
  id: string;
  kind: CommunityPostKind;
  title: string;
  slug: string;
  excerpt: string;
  /** Bounded Markdown source; optional while older API deployments are in use. */
  markdownPreview?: string;
  markdownPreviewTruncated?: boolean;
  score: number;
  commentCount: number;
  viewCount: number;
  hasAcceptedAnswer: boolean;
  createdAt: string;
  lastActivityAt: string;
  author: CommunityAuthor;
  tags: CommunityTag[];
  viewerVote: VoteValue;
  /** For shaping the UI only — the API re-checks ownership on every write. */
  viewerIsAuthor: boolean;
}

export interface CommunityPostDetail extends CommunityPostSummary {
  body: string;
  acceptedCommentId: string | null;
  updatedAt: string;
}

export interface CommunityComment {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  score: number;
  createdAt: string;
  updatedAt: string;
  author: CommunityAuthor;
  isAccepted: boolean;
  viewerVote: VoteValue;
  viewerIsAuthor: boolean;
}

export interface CommunityFeedPage {
  posts: CommunityPostSummary[];
  /** Opaque; hand it straight back to load the next page. Null means the end. */
  nextCursor: string | null;
}

export interface CommunityFeedQuery {
  sort?: CommunityFeedSort;
  tag?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface NewCommunityPost {
  kind: CommunityPostKind;
  title: string;
  body: string;
  tags: string[];
}

export interface VoteResult {
  score: number;
  viewerVote: VoteValue;
}

interface Envelope<T> {
  data: T;
}

interface FeedEnvelope {
  data: CommunityPostSummary[];
  meta: { nextCursor: string | null };
}

/**
 * The community API.
 *
 * Reads work signed out. The auth interceptor attaches a token when one exists,
 * which is what makes the same endpoint return the viewer's own votes.
 */
@Service()
export class CommunityApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}community`;

  listTags(): Observable<CommunityTag[]> {
    return this.http
      .get<Envelope<CommunityTag[]>>(`${this.baseUrl}/tags`)
      .pipe(map((response) => response.data));
  }

  listPosts(query: CommunityFeedQuery): Observable<CommunityFeedPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }

    return this.http
      .get<FeedEnvelope>(`${this.baseUrl}/posts`, { params })
      .pipe(
        map((response) => ({
          posts: response.data,
          nextCursor: response.meta.nextCursor,
        })),
      );
  }

  getPost(slug: string): Observable<CommunityPostDetail> {
    return this.http
      .get<
        Envelope<CommunityPostDetail>
      >(`${this.baseUrl}/posts/${encodeURIComponent(slug)}`)
      .pipe(map((response) => response.data));
  }

  createPost(payload: NewCommunityPost): Observable<CommunityPostDetail> {
    return this.http
      .post<Envelope<CommunityPostDetail>>(`${this.baseUrl}/posts`, payload)
      .pipe(map((response) => response.data));
  }

  updatePost(
    postId: string,
    payload: Partial<NewCommunityPost>,
  ): Observable<CommunityPostDetail> {
    return this.http
      .patch<
        Envelope<CommunityPostDetail>
      >(`${this.baseUrl}/posts/${postId}`, payload)
      .pipe(map((response) => response.data));
  }

  deletePost(postId: string): Observable<void> {
    return this.http
      .delete<Envelope<{ deleted: boolean }>>(`${this.baseUrl}/posts/${postId}`)
      .pipe(map(() => undefined));
  }

  votePost(postId: string, value: VoteValue): Observable<VoteResult> {
    return this.http
      .post<
        Envelope<VoteResult>
      >(`${this.baseUrl}/posts/${postId}/vote`, { value })
      .pipe(map((response) => response.data));
  }

  listComments(postId: string): Observable<CommunityComment[]> {
    return this.http
      .get<
        Envelope<CommunityComment[]>
      >(`${this.baseUrl}/posts/${postId}/comments`)
      .pipe(map((response) => response.data));
  }

  createComment(
    postId: string,
    body: string,
    parentId?: string,
  ): Observable<CommunityComment> {
    return this.http
      .post<Envelope<CommunityComment>>(
        `${this.baseUrl}/posts/${postId}/comments`,
        parentId ? { body, parentId } : { body },
      )
      .pipe(map((response) => response.data));
  }

  updateComment(commentId: string, body: string): Observable<CommunityComment> {
    return this.http
      .patch<
        Envelope<CommunityComment>
      >(`${this.baseUrl}/comments/${commentId}`, { body })
      .pipe(map((response) => response.data));
  }

  deleteComment(commentId: string): Observable<void> {
    return this.http
      .delete<
        Envelope<{ deleted: boolean }>
      >(`${this.baseUrl}/comments/${commentId}`)
      .pipe(map(() => undefined));
  }

  voteComment(commentId: string, value: VoteValue): Observable<VoteResult> {
    return this.http
      .post<
        Envelope<VoteResult>
      >(`${this.baseUrl}/comments/${commentId}/vote`, { value })
      .pipe(map((response) => response.data));
  }

  /** Toggles; the response carries the post's accepted answer after the change. */
  acceptComment(
    commentId: string,
  ): Observable<{ acceptedCommentId: string | null }> {
    return this.http
      .post<
        Envelope<{ acceptedCommentId: string | null }>
      >(`${this.baseUrl}/comments/${commentId}/accept`, {})
      .pipe(map((response) => response.data));
  }
}
