import { Service, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  ProjectsApiService,
  RemoteProject,
} from '../../../core/services/projects-api.service';
import { WorkspaceContextService } from '../../../core/services/workspace-context.service';

export type ProjectSetupMode = 'ai' | 'manual';
export type ProjectStatus = 'online' | 'draft' | 'building';

export interface IoTProject {
  id: string;
  name: string;
  description: string;
  board: string;
  framework: string;
  setupMode: ProjectSetupMode;
  status: ProjectStatus;
  devices: string[];
  /** File paths, hydrated from the API when a project is opened. */
  files: string[];
  deploymentUrl: string;
  updatedAt: number;
}

export interface NewProjectValue {
  name: string;
  setupMode: ProjectSetupMode;
  description: string;
  board: string;
  framework: string;
  devices: string[];
}

/** Raised when the API refuses a write because the plan's ceiling was reached. */
export interface PlanLimitError {
  code: string;
  message: string;
  limit: number;
  used: number;
  planCode: string;
}

export function isPlanLimitError(error: unknown): PlanLimitError | null {
  const body = (error as { error?: { error?: Record<string, unknown> } })?.error
    ?.error;
  if (!body || typeof body['code'] !== 'string') return null;
  if (!body['code'].endsWith('_LIMIT_REACHED')) return null;

  return {
    code: body['code'],
    message: typeof body['message'] === 'string' ? body['message'] : '',
    limit: typeof body['limit'] === 'number' ? body['limit'] : 0,
    used: typeof body['used'] === 'number' ? body['used'] : 0,
    planCode: typeof body['planCode'] === 'string' ? body['planCode'] : '',
  };
}

/**
 * The user's projects, owned by the API.
 *
 * This store previously seeded three sample projects — Smart Greenhouse, Air
 * Quality Node, Smart Irrigation — into browser storage, so every account appeared
 * to own projects it had never created and the usage panel counted them. That data
 * is gone: a new account now legitimately has none, and the page renders its empty
 * state. Sample content belongs to a separate demo environment, never to a real
 * user's account.
 */
@Service()
export class ProjectStore {
  private readonly api = inject(ProjectsApiService);
  private readonly workspaces = inject(WorkspaceContextService);

  private readonly projectState = signal<IoTProject[]>([]);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly fileCreationRequestState = signal<string | null>(null);
  private loaded = false;

  readonly projects = this.projectState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly projectCount = computed(() => this.projectState().length);
  readonly fileCreationRequest = this.fileCreationRequestState.asReadonly();
  /** True once a load has completed, so the page can tell "empty" from "not yet". */
  readonly hasLoaded = computed(() => this.loaded && !this.loadingState());

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;

    this.loadingState.set(true);
    this.errorState.set(null);

    try {
      const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
      if (!workspace) {
        this.projectState.set([]);
        this.loaded = true;
        return;
      }

      const remote = await firstValueFrom(this.api.listProjects(workspace.id));
      this.projectState.set(remote.map((project) => toProject(project)));
      this.loaded = true;
    } catch {
      this.errorState.set('ไม่สามารถโหลดรายการโปรเจกต์ได้');
    } finally {
      this.loadingState.set(false);
    }
  }

  projectById(id: string | null): IoTProject | undefined {
    return this.projectState().find((project) => project.id === id);
  }

  /**
   * Creates a project through the API.
   *
   * Plan limits are enforced by the backend, so a refusal arrives as an error
   * here rather than being predicted locally. The caller surfaces it.
   */
  async create(value: NewProjectValue): Promise<IoTProject> {
    const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
    if (!workspace) throw new Error('No workspace available');

    const created = await firstValueFrom(
      this.api.createProject(workspace.id, {
        name: value.name.trim(),
        description: value.description.trim(),
        board: value.board,
        framework: value.framework,
      }),
    );

    const project = toProject(created, value);
    this.projectState.update((projects) => [project, ...projects]);
    return project;
  }

  async delete(projectId: string): Promise<void> {
    const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
    if (!workspace) return;

    await firstValueFrom(this.api.deleteProject(workspace.id, projectId));
    this.projectState.update((projects) =>
      projects.filter((project) => project.id !== projectId),
    );
  }

  /** Loads the project's file paths, which the editor needs as a plain list. */
  async loadFiles(projectId: string): Promise<string[]> {
    const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
    if (!workspace) return [];

    const files = await firstValueFrom(
      this.api.listFiles(workspace.id, projectId),
    );
    const paths = files.map((file) => file.path);
    this.patch(projectId, { files: paths });
    return paths;
  }

  /** Records a file the editor created, so the tab list stays in step. */
  registerFile(projectId: string, path: string): void {
    const project = this.projectById(projectId);
    if (!project || project.files.includes(path)) return;
    this.patch(projectId, { files: [...project.files, path] });
  }

  /** Records a file the editor deleted. Refuses to drop the last one. */
  unregisterFile(projectId: string, path: string): boolean {
    const project = this.projectById(projectId);
    if (!project || !project.files.includes(path) || project.files.length <= 1) {
      return false;
    }

    this.patch(projectId, {
      files: project.files.filter((file) => file !== path),
    });
    return true;
  }

  requestFileCreation(projectId: string): void {
    if (this.projectById(projectId)) this.fileCreationRequestState.set(projectId);
  }

  clearFileCreationRequest(): void {
    this.fileCreationRequestState.set(null);
  }

  private patch(projectId: string, changes: Partial<IoTProject>): void {
    this.projectState.update((projects) =>
      projects.map((project) =>
        project.id === projectId
          ? { ...project, ...changes, updatedAt: Date.now() }
          : project,
      ),
    );
  }
}

function toProject(
  remote: RemoteProject,
  value?: NewProjectValue,
): IoTProject {
  return {
    id: remote.id,
    name: remote.name,
    description: remote.description,
    board: remote.board,
    framework: remote.framework,
    setupMode: value?.setupMode ?? 'manual',
    // Deployment state is not modelled server-side yet, so every project reads
    // as a draft rather than claiming a status the backend cannot confirm.
    status: 'draft',
    devices: value?.devices ?? [],
    files: [],
    deploymentUrl: 'Not deployed',
    updatedAt: new Date(remote.updatedAt).getTime(),
  };
}
