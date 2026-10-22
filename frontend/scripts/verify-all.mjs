import { buildSync } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.tmp/verification');
mkdirSync(output, { recursive: true });
let failed = false;
for (const name of [
  'verify-devices',
  'verify-firmware',
  'verify-firmware-loader',
  'verify-layout',
  'verify-relay-switching',
  'verify-peripheral-projects',
  'verify-flashing',
  'verify-serial-session',
  'verify-project-files-client',
  'verify-workspace-file-buffers',
  'verify-port-options',
  'verify-sketch-sources',
  'verify-live-overlay',
]) {
  try {
    const outfile = resolve(output, `${name}.cjs`);
    buildSync({
      absWorkingDir: root,
      entryPoints: [`scripts/${name}.ts`],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      loader: { '.md': 'text' },
      outfile,
    });
    const result = spawnSync(process.execPath, [outfile], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
    });
    writeFileSync(resolve(output, `${name}.log`), (result.stdout ?? '') + (result.stderr ?? ''));
    const ok = result.status === 0;
    failed ||= !ok;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${name}: ${(result.stdout ?? '').trim().split('\n').at(-1) ?? ''}`,
    );
    if (!ok) console.error(result.error ?? `${result.stdout}\n${result.stderr}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${name}`, error);
  }
}
process.exitCode = failed ? 1 : 0;
