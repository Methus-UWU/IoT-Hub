import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Regression guard for the Phase 0 containment, widened to the whole API.
 *
 * The legacy workspace module ran a user-controlled PlatformIO project with
 * `execFile` inside this process and handed the child the whole `process.env`.
 * Firmware builds now run in the isolated builder container started by the
 * separate dispatcher (build-worker/), so the API has no reason to start a
 * process at all. This asserts on the source itself rather than on behaviour
 * that would only surface at runtime.
 */
describe('API process isolation', () => {
  const sourceRoot = join(__dirname, '..', '..');

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      // Generated Prisma client code is not ours to police and is never edited.
      if (entry.isDirectory()) {
        return entry.name === 'generated' ? [] : sourceFiles(path);
      }
      // Specs are excluded: this file names the forbidden patterns in order to
      // search for them, and would otherwise report itself.
      const isSource =
        entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts');
      return entry.isFile() && isSource ? [path] : [];
    });
  }

  const files = sourceFiles(sourceRoot).map((path) => ({
    path: relative(sourceRoot, path),
    content: readFileSync(path, 'utf8'),
  }));

  it('reads the API source tree', () => {
    expect(files.some(({ path }) => path.includes('build'))).toBe(true);
  });

  it('never imports a process-spawning module', () => {
    const spawnImport =
      /(?:from\s*['"](?:node:)?(?:child_process|worker_threads|cluster)['"]|(?:require|import)\(\s*['"](?:node:)?(?:child_process|worker_threads|cluster)['"])/;
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

  it('never evaluates code from a string', () => {
    const evaluation = /(?:\beval\s*\(|new\s+Function\s*\()/;
    const offenders = files
      .filter(({ content }) => evaluation.test(content))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});
