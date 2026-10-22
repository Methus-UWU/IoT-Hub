import '@angular/compiler';
import assert from 'node:assert/strict';
import { Injector } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { ProjectsApiService } from '../src/app/core/services/projects-api.service';
import { WorkspaceContextService } from '../src/app/core/services/workspace-context.service';
import { FirmwareLoaderService } from '../src/app/features/user/workspace/virtual-device/services/firmware-loader.service';
import { deviceById } from '../src/app/features/user/workspace/virtual-device/devices/device-catalog';
import { firmwareFor } from '../src/app/features/user/workspace/virtual-device/simulation/firmware/firmware-bus';

const board = { instanceId: 'qa-board', definition: deviceById('esp32-devkit-v1')! };
const source = 'void setup() {} void loop() { delay(100); }';
let checks = 0;
async function check(name: string, test: () => Promise<void>): Promise<void> {
  await test();
  checks++;
  console.log(`PASS ${name}`);
}
function fixture() {
  let workspace: string | null = 'workspace';
  const api = {
    listFiles: () => of([{ path: 'main.ino' }]),
    readFile: () => of({ content: source }),
  };
  const injector = Injector.create({
    providers: [
      { provide: FirmwareLoaderService, useClass: FirmwareLoaderService },
      { provide: ProjectsApiService, useValue: api },
      { provide: WorkspaceContextService, useValue: { activeWorkspaceId: () => workspace } },
    ],
  });
  const loader = injector.get(FirmwareLoaderService);
  return {
    api,
    loader,
    setWorkspace: (value: string | null) => {
      workspace = value;
    },
  };
}

async function main(): Promise<void> {
  await check('missing board, workspace and source are reported', async () => {
    const f = fixture();
    await f.loader.start('project', []);
    assert.match(f.loader.loadError()!, /บอร์ด/);
    f.setWorkspace(null);
    await f.loader.start('project', [board]);
    assert.match(f.loader.loadError()!, /เวิร์กสเปซ/);
    f.setWorkspace('workspace');
    f.api.listFiles = () => of([]);
    await f.loader.start('project', [board]);
    assert.match(f.loader.loadError()!, /ไฟล์/);
    f.loader.stop();
  });
  await check('network and compile failures remain visible', async () => {
    const f = fixture();
    f.api.readFile = () => throwError(() => new Error('offline'));
    await f.loader.start('project', [board]);
    assert.match(f.loader.loadError()!, /ไม่สำเร็จ/);
    f.api.readFile = () => of({ content: 'void setup( {' });
    await f.loader.start('project', [board]);
    assert.equal(f.loader.boards()[0].fault?.phase, 'compile');
    f.loader.stop();
  });
  await check('Stop during source loading cannot attach late firmware', async () => {
    const f = fixture();
    const pending = new Subject<{ content: string }>();
    f.api.readFile = () => pending;
    const started = f.loader.start('project', [board]);
    await Promise.resolve();
    f.loader.stop();
    pending.next({ content: source });
    pending.complete();
    await started;
    assert.equal(f.loader.boards().length, 0);
    assert.equal(firmwareFor(board.instanceId), null);
  });
  await check('a stale failed request cannot overwrite a newer run', async () => {
    const f = fixture();
    const pending = new Subject<{ content: string }>();
    f.api.readFile = () => pending;
    const old = f.loader.start('old-project', [board]);
    await Promise.resolve();
    f.api.readFile = () => of({ content: source });
    await f.loader.start('new-project', [board]);
    const current = firmwareFor(board.instanceId);
    pending.error(new Error('old request failed'));
    await old;
    assert.equal(f.loader.loadError(), null);
    assert.equal(firmwareFor(board.instanceId), current);
    f.loader.stop();
  });
  await check('Stop during file listing prevents the later source read', async () => {
    const f = fixture();
    const pending = new Subject<{ path: string }[]>();
    let reads = 0;
    f.api.listFiles = () => pending;
    f.api.readFile = () => {
      reads++;
      return of({ content: source });
    };
    const started = f.loader.start('project', [board]);
    f.loader.stop();
    pending.next([{ path: 'main.ino' }]);
    pending.complete();
    await started;
    assert.equal(reads, 0);
    assert.equal(f.loader.loadError(), null);
  });
  await check('a stale successful request cannot replace the new board', async () => {
    const f = fixture();
    const pending = new Subject<{ content: string }>();
    f.api.readFile = () => pending;
    const old = f.loader.start('old-project', [board]);
    await Promise.resolve();
    const nextBoard = { ...board, instanceId: 'new-board' };
    f.api.readFile = () => of({ content: source });
    await f.loader.start('new-project', [nextBoard]);
    const current = firmwareFor(nextBoard.instanceId);
    pending.next({ content: source });
    pending.complete();
    await old;
    assert.deepEqual(f.loader.boards().map((state) => state.instanceId), ['new-board']);
    assert.equal(firmwareFor(board.instanceId), null);
    assert.equal(firmwareFor(nextBoard.instanceId), current);
    f.loader.stop();
  });
  console.log(`${checks}/${checks} firmware loader checks passed`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
