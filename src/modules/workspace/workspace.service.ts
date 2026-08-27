import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const MAX_FILE_BYTES = 512 * 1024;
const MAX_PROJECT_FILES = 500;
const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export interface WorkspaceFileEntry {
  path: string;
  size: number;
  updatedAt: string;
}

@Injectable()
export class WorkspaceService {
  private readonly workspaceRoot: string;

  constructor(config: ConfigService) {
    this.workspaceRoot = resolve(
      config.get<string>('WORKSPACE_ROOT') ??
        join(process.cwd(), '.workspace-data'),
    );
  }

  async listFiles(
    userId: string,
    projectId: string,
  ): Promise<WorkspaceFileEntry[]> {
    const projectRoot = this.projectRoot(userId, projectId);
    await fs.mkdir(projectRoot, { recursive: true });
    const files: WorkspaceFileEntry[] = [];
    await this.walkDirectory(projectRoot, projectRoot, files);
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  async readFile(userId: string, projectId: string, filePath: string) {
    const resolvedPath = this.resolveFile(userId, projectId, filePath);
    try {
      const [content, stats] = await Promise.all([
        fs.readFile(resolvedPath, 'utf8'),
        fs.stat(resolvedPath),
      ]);
      return {
        path: this.normalizeFilePath(filePath),
        content,
        size: stats.size,
        updatedAt: stats.mtime.toISOString(),
      };
    } catch (error: unknown) {
      if (this.isFileSystemError(error, 'ENOENT')) {
        throw new NotFoundException('Workspace file was not found');
      }
      throw error;
    }
  }

  async saveFile(
    userId: string,
    projectId: string,
    filePath: string,
    content: string,
  ) {
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
      throw new PayloadTooLargeException(
        `Workspace files are limited to ${MAX_FILE_BYTES} bytes`,
      );
    }

    const normalizedPath = this.normalizeFilePath(filePath);
    const resolvedPath = this.resolveFile(userId, projectId, normalizedPath);
    await fs.mkdir(dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, content, 'utf8');
    const stats = await fs.stat(resolvedPath);
    return {
      path: normalizedPath,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    };
  }

  async deleteFile(userId: string, projectId: string, filePath: string) {
    const normalizedPath = this.normalizeFilePath(filePath);
    const resolvedPath = this.resolveFile(userId, projectId, normalizedPath);

    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        throw new BadRequestException('Only workspace files can be deleted');
      }
      await fs.unlink(resolvedPath);
      return { path: normalizedPath, deleted: true };
    } catch (error: unknown) {
      if (this.isFileSystemError(error, 'ENOENT')) {
        throw new NotFoundException('Workspace file was not found');
      }
      throw error;
    }
  }

  getProjectRoot(userId: string, projectId: string): string {
    return this.projectRoot(userId, projectId);
  }

  private projectRoot(userId: string, projectId: string): string {
    const safeUserId = this.safeIdentifier(userId, 'user');
    const safeProjectId = this.safeIdentifier(projectId, 'project');
    const userRoot = resolve(this.workspaceRoot, safeUserId);
    const projectRoot = resolve(userRoot, safeProjectId);
    this.assertInside(userRoot, projectRoot);
    return projectRoot;
  }

  private resolveFile(
    userId: string,
    projectId: string,
    filePath: string,
  ): string {
    const projectRoot = this.projectRoot(userId, projectId);
    const normalizedPath = this.normalizeFilePath(filePath);
    const resolvedPath = resolve(projectRoot, ...normalizedPath.split('/'));
    this.assertInside(projectRoot, resolvedPath);
    return resolvedPath;
  }

  private normalizeFilePath(filePath: string): string {
    const candidate = filePath.trim().replaceAll('\\', '/');
    if (!candidate || isAbsolute(candidate) || candidate.startsWith('/')) {
      throw new BadRequestException(
        'A relative workspace file path is required',
      );
    }

    const segments = candidate.split('/');
    if (
      segments.length > 12 ||
      segments.some(
        (segment) =>
          !segment ||
          segment === '.' ||
          segment === '..' ||
          !SAFE_SEGMENT.test(segment),
      )
    ) {
      throw new BadRequestException(
        'Workspace file path contains an invalid segment',
      );
    }
    return segments.join('/');
  }

  private safeIdentifier(value: string, label: string): string {
    if (!SAFE_SEGMENT.test(value)) {
      throw new BadRequestException(`Invalid ${label} identifier`);
    }
    return value;
  }

  private assertInside(parent: string, candidate: string): void {
    const pathFromParent = relative(parent, candidate);
    if (
      !pathFromParent ||
      pathFromParent.startsWith(`..${sep}`) ||
      pathFromParent === '..'
    ) {
      throw new BadRequestException(
        'Workspace path escapes the project directory',
      );
    }
  }

  private async walkDirectory(
    projectRoot: string,
    directory: string,
    files: WorkspaceFileEntry[],
  ): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_PROJECT_FILES) {
        throw new BadRequestException(
          `Projects are limited to ${MAX_PROJECT_FILES} files`,
        );
      }
      if (entry.name.startsWith('.')) continue;

      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.walkDirectory(projectRoot, entryPath, files);
        continue;
      }
      if (!entry.isFile()) continue;

      const stats = await fs.stat(entryPath);
      files.push({
        path: relative(projectRoot, entryPath).split(sep).join('/'),
        size: stats.size,
        updatedAt: stats.mtime.toISOString(),
      });
    }
  }

  private isFileSystemError(error: unknown, code: string): boolean {
    // Matched by shape, not prototype: fs errors can cross realms and fail instanceof.
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === code
    );
  }
}
