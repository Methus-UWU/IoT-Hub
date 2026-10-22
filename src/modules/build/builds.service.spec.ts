import { ConflictException, ServiceUnavailableException } from '@nestjs/common';

import type { EntitlementService } from '../billing/entitlement.service';
import type { CircuitState } from '../projects/pin-assignment';
import type { ProjectCircuitService } from '../projects/project-circuit.service';
import type { ProjectFilesService } from '../projects/project-files.service';
import type { Project } from '../projects/project.repository';
import { FakeBuildJobRepository } from './build-job.fake';
import { BuildWorkerService } from './build-worker.service';
import { BuildsService } from './builds.service';
import type { WorkerArtifactDto } from './dto/build.dto';

const TOKEN = 'worker-token-0123456789abcdef0123456789';

const project: Project = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'Blink',
  slug: 'blink',
  description: '',
  // What projects.board really holds: the display name chosen at creation.
  board: 'ESP32 DevKit V1 (30-pin)',
  framework: 'PlatformIO',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const base64 = (text: string) => Buffer.from(text).toString('base64');

const esp32Images: WorkerArtifactDto[] = (
  ['bootloader.bin', 'partitions.bin', 'boot_app0.bin', 'firmware.bin'] as const
).map((name) => ({ name, data: base64(`${name} bytes`) }));

describe('BuildsService', () => {
  let jobs: FakeBuildJobRepository;
  let files: { path: string; content: string }[];
  let entitlements: { assertCanStartBuild: jest.Mock };
  let circuit: CircuitState;
  let service: BuildsService;
  let worker: BuildWorkerService;

  beforeEach(() => {
    process.env.BUILD_WORKER_TOKEN = TOKEN;
    jobs = new FakeBuildJobRepository();
    files = [
      { path: 'platformio.ini', content: '[env:x]' },
      { path: 'src/main.cpp', content: 'void setup() {}\nvoid loop() {}\n' },
    ];
    circuit = {
      components: [
        { id: 'board', definitionId: 'esp32-devkit-v1', label: 'ESP32' },
      ],
      connections: [],
    };
    entitlements = {
      assertCanStartBuild: jest.fn().mockResolvedValue(undefined),
    };
    service = new BuildsService(
      jobs,
      {
        readAll: () => Promise.resolve(files),
      } as unknown as ProjectFilesService,
      {
        load: () => Promise.resolve(circuit),
      } as unknown as ProjectCircuitService,
      entitlements as unknown as EntitlementService,
    );
    worker = new BuildWorkerService(jobs);
  });

  afterEach(() => {
    delete process.env.BUILD_WORKER_TOKEN;
  });

  it('is unavailable until a worker token is configured', async () => {
    delete process.env.BUILD_WORKER_TOKEN;

    await expect(service.request('user-1', project)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('queues a snapshot of the sources, not platformio.ini', async () => {
    const { build, reused } = await service.request('user-1', project);

    expect(reused).toBe(false);
    expect(build.status).toBe('queued');
    expect(build.flash).toEqual({ protocol: 'esptool', baudRate: 460_800 });
    expect(jobs.rows[0].source?.map((file) => file.path)).toEqual([
      'src/main.cpp',
    ]);
  });

  it('builds for the board on the canvas, whatever the stored board name says', async () => {
    circuit = {
      components: [
        { id: 'board', definitionId: 'arduino-uno-r3', label: 'Uno' },
      ],
      connections: [],
    };

    const { build } = await service.request('user-1', project);

    expect(build.boardId).toBe('arduino-uno-r3');
    expect(jobs.rows[0].platform).toBe('atmelavr');
  });

  it('falls back to the stored board name when the canvas has no board', async () => {
    circuit = { components: [], connections: [] };

    const { build } = await service.request('user-1', project);

    expect(build.boardId).toBe('esp32-devkit-v1');
  });

  it('checks build minutes before queuing', async () => {
    entitlements.assertCanStartBuild.mockRejectedValueOnce(
      new ConflictException({ code: 'BUILD_MINUTES_EXHAUSTED' }),
    );

    await expect(service.request('user-1', project)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(jobs.rows).toHaveLength(0);
  });

  it('allows one active build per project', async () => {
    const first = await service.request('user-1', project);
    files[1].content += '// changed\n';

    await expect(service.request('user-1', project)).rejects.toMatchObject({
      response: { code: 'BUILD_ALREADY_ACTIVE', buildId: first.build.id },
    });
  });

  it('reuses a finished build of identical sources without charging minutes', async () => {
    const first = await service.request('user-1', project);
    await worker.claim();
    await worker.complete(first.build.id, {
      status: 'succeeded',
      log: 'ok',
      durationMs: 30_000,
      artifacts: esp32Images,
    });
    entitlements.assertCanStartBuild.mockClear();

    const again = await service.request('user-1', project);

    expect(again).toMatchObject({
      reused: true,
      build: { id: first.build.id },
    });
    expect(entitlements.assertCanStartBuild).not.toHaveBeenCalled();
  });

  it('serves an artifact only under a known name', async () => {
    const { build } = await service.request('user-1', project);
    await worker.claim();
    await worker.complete(build.id, {
      status: 'succeeded',
      log: '',
      durationMs: 1,
      artifacts: esp32Images,
    });

    const image = await service.artifact(project.id, build.id, 'firmware.bin');
    expect(image.content.toString()).toBe('firmware.bin bytes');

    await expect(
      service.artifact(project.id, build.id, '../../etc/passwd'),
    ).rejects.toMatchObject({ response: { code: 'BUILD_ARTIFACT_NOT_FOUND' } });
  });

  it('hides another project’s build', async () => {
    const { build } = await service.request('user-1', project);

    await expect(service.get('project-2', build.id)).rejects.toMatchObject({
      response: { code: 'BUILD_NOT_FOUND' },
    });
  });

  it('cancels an active build and refuses to cancel a finished one', async () => {
    const { build } = await service.request('user-1', project);

    await expect(service.cancel(project.id, build.id)).resolves.toMatchObject({
      status: 'canceled',
    });
    await expect(service.cancel(project.id, build.id)).rejects.toMatchObject({
      response: { code: 'BUILD_NOT_ACTIVE' },
    });
  });

  it('reports a build no worker picked up as timed out', async () => {
    const { build } = await service.request('user-1', project);
    jobs.rows[0].createdAt = new Date(Date.now() - 16 * 60_000);

    await expect(service.get(project.id, build.id)).resolves.toMatchObject({
      status: 'failed',
      failureReason: 'timeout',
    });
  });
});

describe('BuildWorkerService', () => {
  let jobs: FakeBuildJobRepository;
  let worker: BuildWorkerService;

  beforeEach(async () => {
    jobs = new FakeBuildJobRepository();
    worker = new BuildWorkerService(jobs);
    await jobs.enqueue({
      projectId: 'project-1',
      requestedBy: 'user-1',
      boardId: 'esp32-devkit-v1',
      platform: 'espressif32',
      platformBoard: 'esp32doit-devkit-v1',
      files: [{ path: 'src/main.cpp', content: '' }],
      sourceHash: 'hash',
    });
  });

  it('hands out a job once, with only what the build needs', async () => {
    const job = await worker.claim();

    expect(job).toEqual({
      id: jobs.rows[0].id,
      platform: 'espressif32',
      platformBoard: 'esp32doit-devkit-v1',
      files: [{ path: 'src/main.cpp', content: '' }],
    });
    await expect(worker.claim()).resolves.toBeNull();
  });

  it('places ESP32 images at offsets the API decides', async () => {
    const job = await worker.claim();
    await worker.complete(job!.id, {
      status: 'succeeded',
      log: '',
      durationMs: 1,
      artifacts: [...esp32Images].reverse(),
    });

    expect(jobs.rows[0].artifacts.map((a) => [a.name, a.flashOffset])).toEqual([
      ['bootloader.bin', 0x1000],
      ['partitions.bin', 0x8000],
      ['boot_app0.bin', 0xe000],
      ['firmware.bin', 0x10000],
    ]);
  });

  it('turns a success with the wrong image set into an artifact failure', async () => {
    const job = await worker.claim();
    await worker.complete(job!.id, {
      status: 'succeeded',
      log: '',
      durationMs: 1,
      artifacts: [{ name: 'firmware.hex', data: base64('hex') }],
    });

    expect(jobs.rows[0]).toMatchObject({
      status: 'failed',
      failureReason: 'artifacts',
      artifacts: [],
    });
  });

  it('keeps the end of a long log', async () => {
    const job = await worker.claim();
    await worker.complete(job!.id, {
      status: 'failed',
      failureReason: 'compile',
      log: `${'x'.repeat(100_000)}error: expected ';'`,
      durationMs: 1,
    });

    expect(jobs.rows[0].log.length).toBeLessThanOrEqual(65_536);
    expect(jobs.rows[0].log.endsWith("error: expected ';'")).toBe(true);
  });

  it('discards the result of a build that was canceled meanwhile', async () => {
    const job = await worker.claim();
    await jobs.cancel('project-1', job!.id, new Date());

    await expect(
      worker.complete(job!.id, { status: 'failed', log: '', durationMs: 1 }),
    ).rejects.toMatchObject({ response: { code: 'BUILD_NOT_RUNNING' } });
  });
});
