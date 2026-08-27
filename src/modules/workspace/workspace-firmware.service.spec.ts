import { ServiceUnavailableException } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { WorkspaceFirmwareService } from './workspace-firmware.service';

describe('WorkspaceFirmwareService', () => {
  const service = new WorkspaceFirmwareService();

  it('refuses to build', () => {
    expect(() => service.build()).toThrow(ServiceUnavailableException);
  });

  it('refuses to open a serial monitor', () => {
    expect(() => service.startMonitor()).toThrow(ServiceUnavailableException);
  });

  it('reports the toolchain as unavailable instead of probing the host', () => {
    expect(service.toolchainStatus()).toMatchObject({ available: false });
  });

  it('exposes no host serial devices', () => {
    expect(service.listDevices().devices).toEqual([]);
  });

  it('returns an idle serial stream so a polling client stops cleanly', () => {
    expect(service.monitorOutput()).toMatchObject({
      running: false,
      lines: [],
    });
  });
});

/**
 * Regression guard for the Phase 0 containment. The workspace module previously
 * ran a user-controlled PlatformIO project with `execFile` and handed the child
 * the whole `process.env`. Both patterns must stay out of this module until the
 * isolated worker exists, so this asserts on the source itself rather than on
 * behaviour that would only surface at runtime.
 */
describe('workspace module source', () => {
  const moduleDir = __dirname;

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      // Specs are excluded: this file names both forbidden patterns in order to
      // search for them, and would otherwise report itself.
      const isSource =
        entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts');
      return entry.isFile() && isSource ? [path] : [];
    });
  }

  const files = sourceFiles(moduleDir).map((path) => ({
    path,
    content: readFileSync(path, 'utf8'),
  }));

  it('reads at least one source file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('never imports a process-spawning module', () => {
    const spawnImport =
      /(?:from\s*['"]node:child_process['"]|require\(\s*['"](?:node:)?child_process['"])/;
    const offenders = files
      .filter(({ content }) => spawnImport.test(content))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('never spreads the process environment into a child process', () => {
    const offenders = files
      .filter(({ content }) => /\.\.\.process\.env/.test(content))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});
