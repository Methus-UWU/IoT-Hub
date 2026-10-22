import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  MAX_PROJECT_BYTES,
  MAX_PROJECT_FILES,
  assertFileWithinSizeLimit,
  hashFileContent,
  normalizeProjectFilePath,
} from './project-file-path';
import {
  ProjectFileContent,
  ProjectFileRepository,
  ProjectFileSummary,
} from './project.repository';

export interface SaveFileRequest {
  path: string;
  content: string;
  /**
   * The version the client last read. Omitted only when creating a file that the
   * client believes does not exist yet.
   */
  expectedVersion?: number;
}

export interface SaveFileOutcome extends ProjectFileSummary {
  created: boolean;
}

/**
 * Project file operations.
 *
 * Authorization is not performed here — the controller resolves workspace
 * membership first, so every method assumes the caller may already write to this
 * project. Quotas, path safety, and concurrency are enforced here, because they are
 * properties of the data rather than of the caller.
 */
@Injectable()
export class ProjectFilesService {
  constructor(private readonly files: ProjectFileRepository) {}

  list(projectId: string): Promise<ProjectFileSummary[]> {
    return this.files.list(projectId);
  }

  /** Every file with content, read-after-write safe. */
  readAll(projectId: string): Promise<ProjectFileContent[]> {
    return this.files.readAll(projectId);
  }

  async read(projectId: string, rawPath: string) {
    const path = normalizeProjectFilePath(rawPath);
    const file = await this.files.read(projectId, path);

    if (!file) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: 'Project file was not found',
      });
    }

    return file;
  }

  /**
   * Creates or updates one file.
   *
   * A save that omits `expectedVersion` may only create. That is deliberate: a
   * client which has lost track of the version must not be able to blind-write over
   * a revision it never saw.
   */
  async save(
    projectId: string,
    request: SaveFileRequest,
  ): Promise<SaveFileOutcome> {
    const path = normalizeProjectFilePath(request.path);
    const sizeBytes = assertFileWithinSizeLimit(request.content);
    const contentHash = hashFileContent(request.content);

    if (request.expectedVersion === undefined) {
      await this.assertQuotaAllowsNewFile(projectId, sizeBytes);
      const created = await this.files.create(
        projectId,
        path,
        request.content,
        contentHash,
        sizeBytes,
      );
      return { ...created, created: true };
    }

    const updated = await this.files.updateIfVersionMatches(
      projectId,
      path,
      request.expectedVersion,
      request.content,
      contentHash,
      sizeBytes,
    );

    if (updated) return { ...updated, created: false };

    // Either the file is gone or someone else wrote first. Distinguishing the two
    // tells the client whether to recreate or to reconcile.
    const current = await this.files.read(projectId, path);
    if (!current) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: 'Project file was not found',
      });
    }

    throw new ConflictException({
      code: 'FILE_VERSION_CONFLICT',
      message:
        'This file changed since you last loaded it. Reload before saving again.',
      currentVersion: current.version,
      currentHash: current.contentHash,
    });
  }

  /**
   * Batch save for the editor's autosave.
   *
   * Each file is reported independently rather than failing the whole batch: one
   * stale tab must not discard the user's work in every other tab. The client
   * reconciles only the entries marked conflicted.
   */
  async saveMany(
    projectId: string,
    requests: SaveFileRequest[],
  ): Promise<{
    saved: SaveFileOutcome[];
    conflicts: { path: string; currentVersion: number; currentHash: string }[];
  }> {
    const saved: SaveFileOutcome[] = [];
    const conflicts: {
      path: string;
      currentVersion: number;
      currentHash: string;
    }[] = [];

    for (const request of requests) {
      try {
        saved.push(await this.save(projectId, request));
      } catch (error: unknown) {
        if (error instanceof ConflictException) {
          const response = error.getResponse() as {
            code?: string;
            currentVersion?: number;
            currentHash?: string;
          };
          if (response.code === 'FILE_VERSION_CONFLICT') {
            conflicts.push({
              path: normalizeProjectFilePath(request.path),
              currentVersion: response.currentVersion ?? 0,
              currentHash: response.currentHash ?? '',
            });
            continue;
          }
        }
        throw error;
      }
    }

    return { saved, conflicts };
  }

  async delete(projectId: string, rawPath: string) {
    const path = normalizeProjectFilePath(rawPath);
    const deleted = await this.files.delete(projectId, path);

    if (!deleted) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: 'Project file was not found',
      });
    }

    return { path, deleted: true as const };
  }

  /**
   * Writes whole folders at once — an installed library and its dependencies —
   * replacing what was in them. All or nothing: a library half written would not
   * compile, so a broken path, an oversized file, or the project quota stops every
   * folder. Each file must lie inside one of `folders` (`lib/Name/`).
   */
  async replaceFolders(
    projectId: string,
    folders: string[],
    files: { path: string; content: string }[],
  ): Promise<void> {
    const prefixes = folders.map(
      (folder) => `${normalizeProjectFilePath(folder)}/`,
    );
    const rows = files.map((file) => {
      const path = normalizeProjectFilePath(file.path);
      if (!prefixes.some((prefix) => path.startsWith(prefix))) {
        throw new BadRequestException({
          code: 'INVALID_FILE_PATH',
          message: 'A file lies outside the folders being written',
        });
      }
      return {
        path,
        content: file.content,
        contentHash: hashFileContent(file.content),
        sizeBytes: assertFileWithinSizeLimit(file.content),
      };
    });

    const exceeded = await this.files.replaceFolders(
      projectId,
      prefixes,
      rows,
      {
        maxFiles: MAX_PROJECT_FILES,
        maxBytes: MAX_PROJECT_BYTES,
      },
    );
    if (exceeded === 'files') {
      throw new ConflictException({
        code: 'PROJECT_FILE_LIMIT_REACHED',
        message: `Projects are limited to ${MAX_PROJECT_FILES} files`,
      });
    }
    if (exceeded === 'bytes') {
      throw new ConflictException({
        code: 'PROJECT_SIZE_LIMIT_REACHED',
        message: `Projects are limited to ${MAX_PROJECT_BYTES} bytes in total`,
      });
    }
  }

  /** Deletes a folder and everything in it; returns how many files went. */
  deleteFolder(projectId: string, folder: string): Promise<number> {
    return this.files.deleteFolder(
      projectId,
      `${normalizeProjectFilePath(folder)}/`,
    );
  }

  private async assertQuotaAllowsNewFile(
    projectId: string,
    sizeBytes: number,
  ): Promise<void> {
    const usage = await this.files.usage(projectId);

    if (usage.fileCount >= MAX_PROJECT_FILES) {
      throw new ConflictException({
        code: 'PROJECT_FILE_LIMIT_REACHED',
        message: `Projects are limited to ${MAX_PROJECT_FILES} files`,
      });
    }

    if (usage.totalBytes + sizeBytes > MAX_PROJECT_BYTES) {
      throw new ConflictException({
        code: 'PROJECT_SIZE_LIMIT_REACHED',
        message: `Projects are limited to ${MAX_PROJECT_BYTES} bytes in total`,
      });
    }
  }
}
