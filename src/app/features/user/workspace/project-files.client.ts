import { Service, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import {
  ProjectFileContent,
  ProjectsApiService,
} from '../../../core/services/projects-api.service';
import { WorkspaceContextService } from '../../../core/services/workspace-context.service';

/**
 * Project files for the editor, backed by the database rather than the API filesystem.
 *
 * The IDE used to call `/projects/:id/workspace/*`, which reads and writes
 * `.workspace-data/<userId>/<projectId>/` on the API host. Those files are invisible to
 * everything else: another workspace member cannot see them, and — the reason this
 * service exists — neither can the assistant, which reads `project_files` when it needs
 * to know what the project's source actually says. An assistant that cannot read the
 * current `main.ino` cannot patch it without overwriting the user's work.
 *
 * The one thing the old endpoints did not have and this must is a version. `project_files`
 * rejects a write that states a version other than the stored one, which is what stops a
 * second tab — or the assistant applying a change — from silently discarding a revision it
 * never saw. The version travels with the file here rather than through the page, so no
 * caller has to remember to echo it.
 */
@Service()
export class ProjectFilesClient {
  private readonly api = inject(ProjectsApiService);
  private readonly workspaces = inject(WorkspaceContextService);

  /** Last version seen per `projectId:path`. Absent means "not read yet". */
  private readonly versions = new Map<string, number>();
  /** Content the server is known to hold at that version, so an unchanged file is not resent. */
  private readonly confirmed = new Map<string, string>();
  /** The write in flight per file; the next one waits for it. */
  private readonly writes = new Map<string, Promise<void>>();

  async list(projectId: string): Promise<readonly string[]> {
    const workspaceId = await this.workspaceId();
    if (!workspaceId) return [];

    const files = await firstValueFrom(this.api.listFiles(workspaceId, projectId));
    for (const file of files) this.versions.set(key(projectId, file.path), file.version);
    return files.map((file) => file.path);
  }

  async read(projectId: string, path: string): Promise<ProjectFileContent> {
    const workspaceId = await this.requireWorkspaceId();
    const file = await firstValueFrom(this.api.readFile(workspaceId, projectId, path));
    this.versions.set(key(projectId, path), file.version);
    this.confirmed.set(key(projectId, path), file.content);
    return file;
  }

  /**
   * Creates or updates one file.
   *
   * A create omits the version; an update states the one last read. Writes to one file
   * run one at a time: an autosave still in flight and the save before a build used to
   * state the same version, and the second lost with a 409 that the IDE reported as
   * "backend offline". A file whose content already matches what the server confirmed
   * is not sent again.
   *
   * A 409 is resolved by reading the server's copy. If it already holds this exact
   * text, the write is done. Otherwise someone else wrote first — the assistant, another
   * tab — and a `ProjectFileConflictError` says so rather than writing over a revision
   * this editor never saw.
   */
  async save(projectId: string, path: string, content: string): Promise<void> {
    const cacheKey = key(projectId, path);
    const previous = this.writes.get(cacheKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.write(projectId, path, content));
    this.writes.set(cacheKey, next);
    try {
      await next;
    } finally {
      if (this.writes.get(cacheKey) === next) this.writes.delete(cacheKey);
    }
  }

  private async write(projectId: string, path: string, content: string): Promise<void> {
    const cacheKey = key(projectId, path);
    if (this.versions.has(cacheKey) && this.confirmed.get(cacheKey) === content) return;

    const workspaceId = await this.requireWorkspaceId();
    const expectedVersion = this.versions.get(cacheKey);

    try {
      const result = await firstValueFrom(
        this.api.saveFile(workspaceId, projectId, {
          path,
          content,
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        }),
      );
      this.versions.set(cacheKey, result.version);
      this.confirmed.set(cacheKey, content);
    } catch (error: unknown) {
      if (!(error instanceof HttpErrorResponse)) throw error;
      if (error.status === 404) {
        // The row is gone; the next save creates it.
        this.forgetFile(cacheKey);
        throw error;
      }
      if (error.status !== 409) throw error;

      const current = await firstValueFrom(this.api.readFile(workspaceId, projectId, path)).catch(
        () => null,
      );
      if (!current) {
        this.forgetFile(cacheKey);
        throw error;
      }
      this.versions.set(cacheKey, current.version);
      this.confirmed.set(cacheKey, current.content);
      if (current.content === content) return;
      throw new ProjectFileConflictError(path);
    }
  }

  async delete(projectId: string, path: string): Promise<void> {
    const workspaceId = await this.requireWorkspaceId();
    await firstValueFrom(this.api.deleteFile(workspaceId, projectId, path));
    this.forgetFile(key(projectId, path));
  }

  /**
   * Forgets cached versions, e.g. after the assistant rewrote files.
   *
   * With `paths`, only those files: forgetting a file nobody else wrote would make its
   * next save omit the version, and the server would report a conflict that is not one.
   */
  forget(projectId: string, paths?: readonly string[]): void {
    if (paths) {
      for (const path of paths) this.forgetFile(key(projectId, path));
      return;
    }
    const prefix = `${projectId}:`;
    for (const cacheKey of [...this.versions.keys(), ...this.confirmed.keys()]) {
      if (cacheKey.startsWith(prefix)) this.forgetFile(cacheKey);
    }
  }

  private forgetFile(cacheKey: string): void {
    this.versions.delete(cacheKey);
    this.confirmed.delete(cacheKey);
  }

  private async requireWorkspaceId(): Promise<string> {
    const workspaceId = await this.workspaceId();
    if (!workspaceId) throw new Error('No workspace is available for this account');
    return workspaceId;
  }

  private async workspaceId(): Promise<string | null> {
    const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
    return workspace?.id ?? null;
  }
}

/** Another writer changed the file since this editor last read it. */
export class ProjectFileConflictError extends Error {
  constructor(readonly path: string) {
    super(`${path} was changed elsewhere`);
    this.name = 'ProjectFileConflictError';
  }
}

function key(projectId: string, path: string): string {
  return `${projectId}:${path}`;
}
