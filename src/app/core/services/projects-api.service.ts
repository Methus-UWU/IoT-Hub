import { HttpClient, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

export type WorkspaceRole =
  | 'owner'
  | 'admin'
  | 'developer'
  | 'editor'
  | 'viewer';

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  /** The signed-in user's role here. For shaping UI only — the API re-checks. */
  role: WorkspaceRole;
}

export interface RemoteProject {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string;
  board: string;
  framework: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFileSummary {
  path: string;
  sizeBytes: number;
  contentHash: string;
  /** Must be echoed back on save; the server rejects a stale version. */
  version: number;
  updatedAt: string;
}

export interface ProjectFileContent extends ProjectFileSummary {
  content: string;
}

export interface SaveFileRequest {
  path: string;
  content: string;
  /** Omit only when creating. Present means "update, if still at this version". */
  expectedVersion?: number;
}

export interface SaveFileResult extends ProjectFileSummary {
  created: boolean;
}

export interface FileConflict {
  path: string;
  currentVersion: number;
  currentHash: string;
}

export interface BatchSaveResult {
  saved: SaveFileResult[];
  /** Files another writer changed first. Reconcile these; do not retry blindly. */
  conflicts: FileConflict[];
}

/**
 * Client for the workspace, project, and project-file API.
 *
 * Files are database rows now, not paths on the API host, so every call is scoped
 * by workspace and project id rather than by the signed-in user. The server
 * authorizes both, which is why an id appearing in a URL is not a permission.
 */
@Service()
export class ProjectsApiService {
  private readonly http = inject(HttpClient);

  listWorkspaces(): Observable<WorkspaceSummary[]> {
    return this.http.get<WorkspaceSummary[]>(`${environment.apiUrl}workspaces`);
  }

  listProjects(workspaceId: string): Observable<RemoteProject[]> {
    return this.http.get<RemoteProject[]>(this.projectsUrl(workspaceId));
  }

  createProject(
    workspaceId: string,
    body: {
      name: string;
      description?: string;
      board?: string;
      framework?: string;
    },
  ): Observable<RemoteProject> {
    return this.http.post<RemoteProject>(this.projectsUrl(workspaceId), body);
  }

  deleteProject(
    workspaceId: string,
    projectId: string,
  ): Observable<{ deleted: true }> {
    return this.http.delete<{ deleted: true }>(
      `${this.projectsUrl(workspaceId)}/${projectId}`,
    );
  }

  listFiles(
    workspaceId: string,
    projectId: string,
  ): Observable<ProjectFileSummary[]> {
    return this.http.get<ProjectFileSummary[]>(
      `${this.projectUrl(workspaceId, projectId)}/files`,
    );
  }

  readFile(
    workspaceId: string,
    projectId: string,
    path: string,
  ): Observable<ProjectFileContent> {
    return this.http.get<ProjectFileContent>(
      `${this.projectUrl(workspaceId, projectId)}/file`,
      { params: new HttpParams().set('path', path) },
    );
  }

  saveFile(
    workspaceId: string,
    projectId: string,
    request: SaveFileRequest,
  ): Observable<SaveFileResult> {
    return this.http.put<SaveFileResult>(
      `${this.projectUrl(workspaceId, projectId)}/file`,
      request,
    );
  }

  /**
   * Batch save for autosave: send only the files the editor marked dirty.
   *
   * Outcomes are per file. A conflict on one path does not discard the others, so
   * one stale tab cannot cost the user their work everywhere else.
   */
  saveFiles(
    workspaceId: string,
    projectId: string,
    files: SaveFileRequest[],
  ): Observable<BatchSaveResult> {
    return this.http.put<BatchSaveResult>(
      `${this.projectUrl(workspaceId, projectId)}/files`,
      { files },
    );
  }

  deleteFile(
    workspaceId: string,
    projectId: string,
    path: string,
  ): Observable<{ path: string; deleted: true }> {
    return this.http.delete<{ path: string; deleted: true }>(
      `${this.projectUrl(workspaceId, projectId)}/file`,
      { params: new HttpParams().set('path', path) },
    );
  }

  private projectsUrl(workspaceId: string): string {
    return `${environment.apiUrl}workspaces/${encodeURIComponent(workspaceId)}/projects`;
  }

  private projectUrl(workspaceId: string, projectId: string): string {
    return `${this.projectsUrl(workspaceId)}/${encodeURIComponent(projectId)}`;
  }
}
