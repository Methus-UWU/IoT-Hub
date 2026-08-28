/**
 * Persistence contracts for projects and their files.
 *
 * Quota checks need aggregates (file count, total bytes) that only the database can
 * answer cheaply, so those are repository methods rather than something the service
 * computes by loading every row.
 *
 * See docs/adr/ADR-001-database-access.md and ADR-004.
 */

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string;
  board: string;
  framework: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  workspaceId: string;
  name: string;
  slug: string;
  description?: string;
  board?: string;
  framework?: string;
}

/** File metadata without content, for listings. */
export interface ProjectFileSummary {
  path: string;
  sizeBytes: number;
  contentHash: string;
  version: number;
  updatedAt: Date;
}

export interface ProjectFileContent extends ProjectFileSummary {
  content: string;
}

export interface ProjectUsage {
  fileCount: number;
  totalBytes: number;
}

export abstract class ProjectRepository {
  abstract findById(projectId: string): Promise<Project | null>;

  abstract listForWorkspace(workspaceId: string): Promise<Project[]>;

  abstract slugExists(workspaceId: string, slug: string): Promise<boolean>;

  abstract create(input: CreateProjectInput): Promise<Project>;

  abstract delete(projectId: string): Promise<void>;
}

export abstract class ProjectFileRepository {
  abstract list(projectId: string): Promise<ProjectFileSummary[]>;

  abstract read(
    projectId: string,
    path: string,
  ): Promise<ProjectFileContent | null>;

  abstract usage(projectId: string): Promise<ProjectUsage>;

  /**
   * Creates the file. Rejects with a duplicate-path error if it already exists —
   * the unique index is what guarantees that, not a prior existence check, so two
   * concurrent creates cannot both succeed.
   */
  abstract create(
    projectId: string,
    path: string,
    content: string,
    contentHash: string,
    sizeBytes: number,
  ): Promise<ProjectFileSummary>;

  /**
   * Updates only if the stored version still matches `expectedVersion`, and returns
   * null when it does not. A caller that finds null must not retry blindly: the
   * file changed underneath it.
   */
  abstract updateIfVersionMatches(
    projectId: string,
    path: string,
    expectedVersion: number,
    content: string,
    contentHash: string,
    sizeBytes: number,
  ): Promise<ProjectFileSummary | null>;

  abstract delete(projectId: string, path: string): Promise<boolean>;

  abstract exists(projectId: string, path: string): Promise<boolean>;
}

export interface ProjectComponent {
  id: string;
  definitionId: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  state: Record<string, unknown>;
}

export interface CreateComponentInput {
  definitionId: string;
  label?: string;
  x: number;
  y: number;
  rotation?: number;
  state?: Record<string, unknown>;
}

export interface UpdateComponentInput {
  label?: string;
  x?: number;
  y?: number;
  rotation?: number;
  state?: Record<string, unknown>;
}

export abstract class ProjectComponentRepository {
  abstract list(projectId: string): Promise<ProjectComponent[]>;

  abstract findById(
    projectId: string,
    componentId: string,
  ): Promise<ProjectComponent | null>;

  abstract count(projectId: string): Promise<number>;

  abstract create(
    projectId: string,
    input: CreateComponentInput,
  ): Promise<ProjectComponent>;

  abstract update(
    projectId: string,
    componentId: string,
    input: UpdateComponentInput,
  ): Promise<ProjectComponent | null>;

  abstract delete(projectId: string, componentId: string): Promise<boolean>;

  /**
   * Creates the project and its board component together.
   *
   * One transaction, because a project whose board failed to save would open to
   * an empty canvas after the user had already chosen a board — exactly the
   * behaviour this flow exists to prevent.
   */
  abstract createProjectWithBoard(
    project: CreateProjectInput,
    board: CreateComponentInput,
  ): Promise<{ project: Project; component: ProjectComponent }>;
}
