import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkspaceService } from './workspace.service';

describe('WorkspaceService.deleteFile', () => {
  const userId = 'user1';
  const projectId = 'proj1';
  let root: string;
  let service: WorkspaceService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'workspace-delete-'));
    service = new WorkspaceService({
      get: () => root,
    } as unknown as ConfigService);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('removes a saved file from the project directory', async () => {
    await service.saveFile(userId, projectId, 'main.cpp', 'void loop() {}');

    await expect(
      service.deleteFile(userId, projectId, 'main.cpp'),
    ).resolves.toEqual({ path: 'main.cpp', deleted: true });

    const projectRoot = service.getProjectRoot(userId, projectId);
    await expect(fs.stat(join(projectRoot, 'main.cpp'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('reports a missing file instead of failing silently', async () => {
    await expect(
      service.deleteFile(userId, projectId, 'never-created.cpp'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to delete outside the project directory', async () => {
    await expect(
      service.deleteFile(userId, projectId, '../escape.cpp'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to delete a directory', async () => {
    await service.saveFile(userId, projectId, 'lib/sensor.cpp', '// sensor');

    await expect(
      service.deleteFile(userId, projectId, 'lib'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves other files untouched', async () => {
    await service.saveFile(userId, projectId, 'main.cpp', 'a');
    await service.saveFile(userId, projectId, 'sensors.cpp', 'b');

    await service.deleteFile(userId, projectId, 'main.cpp');

    await expect(service.listFiles(userId, projectId)).resolves.toEqual([
      expect.objectContaining({ path: 'sensors.cpp' }),
    ]);
  });
});
