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

export interface BoardDefinition {
  id: string;
  name: string;
  defaultFramework: string;
}

export interface RemoteComponent {
  id: string;
  definitionId: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  state: Record<string, unknown>;
}

export interface UsageMetricDto {
  key: string;
  label: string;
  used: number;
  limit: number;
  unlimited: boolean;
  percent: number;
  unit?: string;
}

export interface ProjectUsageReport {
  plan: { code: string; name: string };
  metrics: UsageMetricDto[];
}

export interface RemoteConnection {
  id: string;
  from: { componentId: string; pinId: string };
  to: { componentId: string; pinId: string };
  color: string;
  kind: 'power' | 'ground' | 'signal';
  waypoints: { x: number; y: number }[];
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

  /** Boards a project can start from. One list, served by the backend. */
  listBoards(): Observable<BoardDefinition[]> {
    return this.http.get<BoardDefinition[]>(`${environment.apiUrl}boards`);
  }

  /** Device and connection counts against the plan's per-project ceilings. */
  projectUsage(
    workspaceId: string,
    projectId: string,
  ): Observable<ProjectUsageReport> {
    return this.http.get<ProjectUsageReport>(
      `${this.projectUrl(workspaceId, projectId)}/usage`,
    );
  }

  listComponents(
    workspaceId: string,
    projectId: string,
  ): Observable<RemoteComponent[]> {
    return this.http.get<RemoteComponent[]>(
      `${this.projectUrl(workspaceId, projectId)}/components`,
    );
  }

  /** Omit x and y to let the server place it where nothing is stacked. */
  addComponent(
    workspaceId: string,
    projectId: string,
    body: {
      definitionId: string;
      label?: string;
      x?: number;
      y?: number;
      rotation?: number;
      state?: Record<string, unknown>;
    },
  ): Observable<RemoteComponent> {
    return this.http.post<RemoteComponent>(
      `${this.projectUrl(workspaceId, projectId)}/components`,
      body,
    );
  }

  updateComponent(
    workspaceId: string,
    projectId: string,
    componentId: string,
    body: {
      label?: string;
      x?: number;
      y?: number;
      rotation?: number;
      state?: Record<string, unknown>;
    },
  ): Observable<RemoteComponent> {
    return this.http.patch<RemoteComponent>(
      `${this.projectUrl(workspaceId, projectId)}/components/${encodeURIComponent(componentId)}`,
      body,
    );
  }

  deleteComponent(
    workspaceId: string,
    projectId: string,
    componentId: string,
  ): Observable<{ deleted: true }> {
    return this.http.delete<{ deleted: true }>(
      `${this.projectUrl(workspaceId, projectId)}/components/${encodeURIComponent(componentId)}`,
    );
  }

  listConnections(
    workspaceId: string,
    projectId: string,
  ): Observable<RemoteConnection[]> {
    return this.http.get<RemoteConnection[]>(
      this.connectionsUrl(workspaceId, projectId),
    );
  }

  addConnection(
    workspaceId: string,
    projectId: string,
    body: {
      from: { componentId: string; pinId: string };
      to: { componentId: string; pinId: string };
      color?: string;
      kind?: 'power' | 'ground' | 'signal';
      waypoints?: { x: number; y: number }[];
    },
  ): Observable<RemoteConnection> {
    return this.http.post<RemoteConnection>(
      this.connectionsUrl(workspaceId, projectId),
      body,
    );
  }

  /** Replaces every manual bend. An empty array resets to automatic routing. */
  updateConnectionWaypoints(
    workspaceId: string,
    projectId: string,
    connectionId: string,
    waypoints: { x: number; y: number }[],
  ): Observable<RemoteConnection> {
    return this.http.patch<RemoteConnection>(
      this.connectionUrl(workspaceId, projectId, connectionId),
      { waypoints },
    );
  }

  deleteConnection(
    workspaceId: string,
    projectId: string,
    connectionId: string,
  ): Observable<{ deleted: true }> {
    return this.http.delete<{ deleted: true }>(
      this.connectionUrl(workspaceId, projectId, connectionId),
    );
  }

  listProjects(workspaceId: string): Observable<RemoteProject[]> {
    return this.http.get<RemoteProject[]>(this.projectsUrl(workspaceId));
  }

  createProject(
    workspaceId: string,
    body: {
      name: string;
      description?: string;
      /** Catalog id; the backend creates this board as the project's first component. */
      boardId: string;
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

  private connectionsUrl(workspaceId: string, projectId: string): string {
    return this.projectUrl(workspaceId, projectId) + '/connections';
  }

  private connectionUrl(
    workspaceId: string,
    projectId: string,
    connectionId: string,
  ): string {
    return (
      this.connectionsUrl(workspaceId, projectId) +
      '/' +
      encodeURIComponent(connectionId)
    );
  }

  private projectsUrl(workspaceId: string): string {
    return `${environment.apiUrl}workspaces/${encodeURIComponent(workspaceId)}/projects`;
  }

  private projectUrl(workspaceId: string, projectId: string): string {
    return `${this.projectsUrl(workspaceId)}/${encodeURIComponent(projectId)}`;
  }
}
