import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import {
  CreateFileInput,
  ProjectFileContent,
  ProjectFileRepository,
  ProjectFileSummary,
  ProjectUsage,
} from './project.repository';

/**
 * In-memory store keyed exactly like the unique index, so the isolation the
 * database provides is the isolation these tests exercise.
 */
export class FakeProjectFileRepository extends ProjectFileRepository {
  private readonly rows = new Map<string, ProjectFileContent>();

  private key(projectId: string, path: string): string {
    return `${projectId}\u0000${path}`;
  }

  seed(projectId: string, path: string, content: string, version = 1): void {
    this.rows.set(this.key(projectId, path), {
      path,
      content,
      contentHash: createHash('sha256').update(content, 'utf8').digest('hex'),
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      version,
      updatedAt: new Date(),
    });
  }

  list(projectId: string): Promise<ProjectFileSummary[]> {
    return Promise.resolve(
      [...this.rows.entries()]
        .filter(([key]) => key.startsWith(`${projectId}\u0000`))
        .map(([, row]) => row),
    );
  }

  read(projectId: string, path: string): Promise<ProjectFileContent | null> {
    return Promise.resolve(this.rows.get(this.key(projectId, path)) ?? null);
  }

  readAll(projectId: string): Promise<ProjectFileContent[]> {
    return Promise.resolve(
      [...this.rows.entries()]
        .filter(([key]) => key.startsWith(`${projectId}\u0000`))
        .map(([, row]) => row),
    );
  }

  usage(projectId: string): Promise<ProjectUsage> {
    const rows = [...this.rows.entries()].filter(([key]) =>
      key.startsWith(`${projectId}\u0000`),
    );
    return Promise.resolve({
      fileCount: rows.length,
      totalBytes: rows.reduce((sum, [, row]) => sum + row.sizeBytes, 0),
    });
  }

  create(
    projectId: string,
    path: string,
    content: string,
    contentHash: string,
    sizeBytes: number,
  ): Promise<ProjectFileSummary> {
    if (this.rows.has(this.key(projectId, path))) {
      return Promise.reject(
        new ConflictException({ code: 'FILE_ALREADY_EXISTS' }),
      );
    }
    const row: ProjectFileContent = {
      path,
      content,
      contentHash,
      sizeBytes,
      version: 1,
      updatedAt: new Date(),
    };
    this.rows.set(this.key(projectId, path), row);
    return Promise.resolve(row);
  }

  updateIfVersionMatches(
    projectId: string,
    path: string,
    expectedVersion: number,
    content: string,
    contentHash: string,
    sizeBytes: number,
  ): Promise<ProjectFileSummary | null> {
    const row = this.rows.get(this.key(projectId, path));
    if (!row || row.version !== expectedVersion) return Promise.resolve(null);

    const next: ProjectFileContent = {
      ...row,
      content,
      contentHash,
      sizeBytes,
      version: row.version + 1,
      updatedAt: new Date(),
    };
    this.rows.set(this.key(projectId, path), next);
    return Promise.resolve(next);
  }

  delete(projectId: string, path: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(this.key(projectId, path)));
  }

  exists(projectId: string, path: string): Promise<boolean> {
    return Promise.resolve(this.rows.has(this.key(projectId, path)));
  }

  replaceFolders(
    projectId: string,
    folders: string[],
    files: CreateFileInput[],
    quota: { maxFiles: number; maxBytes: number },
  ): Promise<'files' | 'bytes' | null> {
    const kept = [...this.rows.entries()].filter(
      ([key, row]) =>
        key.startsWith(`${projectId}\u0000`) &&
        !folders.some((folder) => row.path.startsWith(folder)),
    );
    const count = kept.length + files.length;
    const bytes =
      kept.reduce((sum, [, row]) => sum + row.sizeBytes, 0) +
      files.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (count > quota.maxFiles) return Promise.resolve('files');
    if (bytes > quota.maxBytes) return Promise.resolve('bytes');
    for (const [key, row] of [...this.rows.entries()]) {
      if (
        key.startsWith(`${projectId}\u0000`) &&
        folders.some((folder) => row.path.startsWith(folder))
      ) {
        this.rows.delete(key);
      }
    }
    for (const file of files) {
      this.rows.set(this.key(projectId, file.path), {
        ...file,
        version: 1,
        updatedAt: new Date(),
      });
    }
    return Promise.resolve(null);
  }

  deleteFolder(projectId: string, folder: string): Promise<number> {
    let count = 0;
    for (const [key, row] of [...this.rows.entries()]) {
      if (key.startsWith(`${projectId}\u0000`) && row.path.startsWith(folder)) {
        this.rows.delete(key);
        count++;
      }
    }
    return Promise.resolve(count);
  }
}
