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
