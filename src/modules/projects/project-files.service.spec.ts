import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

import { MAX_FILE_BYTES, MAX_PROJECT_FILES } from './project-file-path';
import { ProjectFilesService } from './project-files.service';
import {
  ProjectFileContent,
  ProjectFileRepository,
  ProjectFileSummary,
  ProjectUsage,
} from './project.repository';

const PROJECT = 'project-1';
const OTHER_PROJECT = 'project-2';

/**
 * In-memory store keyed exactly like the unique index, so the isolation the
 * database provides is the isolation these tests exercise.
 */
class FakeProjectFileRepository extends ProjectFileRepository {
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
}

describe('ProjectFilesService', () => {
  let repository: FakeProjectFileRepository;
  let service: ProjectFilesService;

  beforeEach(() => {
    repository = new FakeProjectFileRepository();
    service = new ProjectFilesService(repository);
  });

  describe('path safety', () => {
    // These are the rules carried over from the filesystem implementation. They
    // must not weaken during the storage migration.
    const rejected = [
      ['parent traversal', '../escape.cpp'],
      ['nested traversal', 'src/../../escape.cpp'],
      ['absolute path', '/etc/passwd'],
      ['windows absolute', 'C:/Windows/system32'],
      ['backslash traversal', '..\\escape.cpp'],
      ['current directory segment', './main.cpp'],
      ['empty segment', 'src//main.cpp'],
      ['trailing slash', 'src/'],
      ['empty path', ''],
      ['whitespace only', '   '],
      ['leading dot segment', '.env'],
      ['leading hyphen', '-rf.cpp'],
      ['null byte', 'main\u0000.cpp'],
      ['too deep', 'a/b/c/d/e/f/g/h/i/j/k/l/m.cpp'],
    ] as const;

    for (const [label, path] of rejected) {
      it(`rejects ${label}`, async () => {
        await expect(
          service.save(PROJECT, { path, content: 'x' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    }

    const accepted = [
      'main.cpp',
      'src/main.cpp',
      'include/sensors.h',
      'platformio.ini',
      'lib/My_Lib/my-lib.cpp',
    ];

    for (const path of accepted) {
      it(`accepts ${path}`, async () => {
        await expect(
          service.save(PROJECT, { path, content: 'x' }),
        ).resolves.toMatchObject({ path, created: true });
      });
    }

    it('normalises backslashes to forward slashes', async () => {
      const saved = await service.save(PROJECT, {
        path: 'src\\main.cpp',
        content: 'x',
      });

      expect(saved.path).toBe('src/main.cpp');
    });

    it('rejects a traversal on delete as well as on save', async () => {
      await expect(
        service.delete(PROJECT, '../escape.cpp'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a traversal on read', async () => {
      await expect(
        service.read(PROJECT, '../escape.cpp'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('cross-project isolation', () => {
    it('does not read another project file at the same path', async () => {
      repository.seed(OTHER_PROJECT, 'secret.cpp', 'other tenant data');

      await expect(service.read(PROJECT, 'secret.cpp')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lists only its own files', async () => {
      repository.seed(PROJECT, 'mine.cpp', 'a');
      repository.seed(OTHER_PROJECT, 'theirs.cpp', 'b');

      const listed = await service.list(PROJECT);

      expect(listed.map((file) => file.path)).toEqual(['mine.cpp']);
    });

    it('deleting in one project leaves the other untouched', async () => {
      repository.seed(PROJECT, 'shared-name.cpp', 'a');
      repository.seed(OTHER_PROJECT, 'shared-name.cpp', 'b');

      await service.delete(PROJECT, 'shared-name.cpp');

      await expect(
        repository.exists(OTHER_PROJECT, 'shared-name.cpp'),
      ).resolves.toBe(true);
    });
  });

  describe('optimistic concurrency', () => {
    it('increments the version on a successful save', async () => {
      repository.seed(PROJECT, 'main.cpp', 'v1');

      const saved = await service.save(PROJECT, {
        path: 'main.cpp',
        content: 'v2',
        expectedVersion: 1,
      });

      expect(saved.version).toBe(2);
      expect(saved.created).toBe(false);
    });

    it('refuses to overwrite a newer revision', async () => {
      repository.seed(PROJECT, 'main.cpp', 'v1');
      await service.save(PROJECT, {
        path: 'main.cpp',
        content: 'from tab A',
        expectedVersion: 1,
      });

      // Tab B still believes it holds version 1.
      await expect(
        service.save(PROJECT, {
          path: 'main.cpp',
          content: 'from tab B',
          expectedVersion: 1,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('preserves the newer content after a rejected save', async () => {
      repository.seed(PROJECT, 'main.cpp', 'v1');
      await service.save(PROJECT, {
        path: 'main.cpp',
        content: 'from tab A',
        expectedVersion: 1,
      });

      await service
        .save(PROJECT, {
          path: 'main.cpp',
          content: 'from tab B',
          expectedVersion: 1,
        })
        .catch(() => undefined);

      const current = await service.read(PROJECT, 'main.cpp');
      expect(current.content).toBe('from tab A');
    });

    it('reports the current version so the client can reconcile', async () => {
      repository.seed(PROJECT, 'main.cpp', 'v1', 7);

      const error = await service
        .save(PROJECT, {
          path: 'main.cpp',
          content: 'stale',
          expectedVersion: 3,
        })
        .catch((thrown: ConflictException) => thrown.getResponse());

      expect(error).toMatchObject({
        code: 'FILE_VERSION_CONFLICT',
        currentVersion: 7,
      });
    });

    it('refuses a blind create over an existing file', async () => {
      repository.seed(PROJECT, 'main.cpp', 'v1');

      // No expectedVersion means "create", which must not clobber.
      await expect(
        service.save(PROJECT, { path: 'main.cpp', content: 'blind' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reports a missing file rather than a conflict when it was deleted', async () => {
      await expect(
        service.save(PROJECT, {
          path: 'gone.cpp',
          content: 'x',
          expectedVersion: 2,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('batch autosave', () => {
    it('saves every dirty file in one call', async () => {
      repository.seed(PROJECT, 'a.cpp', 'a1');
      repository.seed(PROJECT, 'b.cpp', 'b1');

      const result = await service.saveMany(PROJECT, [
        { path: 'a.cpp', content: 'a2', expectedVersion: 1 },
        { path: 'b.cpp', content: 'b2', expectedVersion: 1 },
      ]);

      expect(result.saved).toHaveLength(2);
      expect(result.conflicts).toEqual([]);
    });

    it('one stale file does not discard the rest of the batch', async () => {
      repository.seed(PROJECT, 'fresh.cpp', 'f1');
      repository.seed(PROJECT, 'stale.cpp', 's1', 5);

      const result = await service.saveMany(PROJECT, [
        { path: 'fresh.cpp', content: 'f2', expectedVersion: 1 },
        { path: 'stale.cpp', content: 's2', expectedVersion: 1 },
      ]);

      expect(result.saved.map((file) => file.path)).toEqual(['fresh.cpp']);
      expect(result.conflicts).toEqual([
        expect.objectContaining({ path: 'stale.cpp', currentVersion: 5 }),
      ]);
      // The file that did save is genuinely saved.
      await expect(service.read(PROJECT, 'fresh.cpp')).resolves.toMatchObject({
        content: 'f2',
      });
    });
  });

  describe('quotas', () => {
    it('rejects a file over the size limit', async () => {
      await expect(
        service.save(PROJECT, {
          path: 'big.cpp',
          content: 'x'.repeat(MAX_FILE_BYTES + 1),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a file exactly at the size limit', async () => {
      await expect(
        service.save(PROJECT, {
          path: 'exact.cpp',
          content: 'x'.repeat(MAX_FILE_BYTES),
        }),
      ).resolves.toMatchObject({ created: true });
    });

    it('counts multi-byte characters as bytes, not characters', async () => {
      // A naive length check would let roughly three times the limit through.
      await expect(
        service.save(PROJECT, {
          path: 'thai.cpp',
          content: 'ก'.repeat(MAX_FILE_BYTES),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a new file once the project file limit is reached', async () => {
      for (let index = 0; index < MAX_PROJECT_FILES; index++) {
        repository.seed(PROJECT, `file${index}.cpp`, 'x');
      }

      await expect(
        service.save(PROJECT, { path: 'one-too-many.cpp', content: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('still allows updating an existing file at the file limit', async () => {
      for (let index = 0; index < MAX_PROJECT_FILES; index++) {
        repository.seed(PROJECT, `file${index}.cpp`, 'x');
      }

      await expect(
        service.save(PROJECT, {
          path: 'file0.cpp',
          content: 'updated',
          expectedVersion: 1,
        }),
      ).resolves.toMatchObject({ created: false });
    });
  });

  describe('content integrity', () => {
    it('stores a hash that matches the content', async () => {
      const content = 'void setup() {}';
      const saved = await service.save(PROJECT, {
        path: 'main.cpp',
        content,
      });

      expect(saved.contentHash).toBe(
        createHash('sha256').update(content, 'utf8').digest('hex'),
      );
    });

    it('records the byte size', async () => {
      const saved = await service.save(PROJECT, {
        path: 'main.cpp',
        content: 'ก',
      });

      expect(saved.sizeBytes).toBe(3);
    });
  });
});
