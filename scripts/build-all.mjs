#!/usr/bin/env node
/**
 * One command that produces every artifact a deployment needs.
 *
 * Written in Node rather than as a shell script because the same file has to run
 * on the Windows development machines and inside the Linux build container. Node
 * is already a hard requirement of both sub-projects, so this adds no dependency.
 *
 * Steps, in order:
 *   1. install    npm ci in each sub-project        (skipped unless --install)
 *   2. generate   prisma generate                   (writes src/generated/prisma)
 *   3. build:be   nest build                        (writes dist/src)
 *   4. build:fe   ng build                          (writes dist/frontend/browser)
 *   5. verify     the entry points actually exist
 *
 * Step 5 matters more than it looks: `nest build` empties dist/ before it writes,
 * so an interrupted build leaves a directory that is present but unusable. The
 * verification turns that into an error here instead of a MODULE_NOT_FOUND when
 * the container starts.
 *
 * Usage:
 *   node scripts/build-all.mjs              build from the installed dependencies
 *   node scripts/build-all.mjs --install    npm ci first (use in Docker and CI)
 *   node scripts/build-all.mjs --be         backend only
 *   node scripts/build-all.mjs --fe         frontend only
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = join(root, 'backend');
const frontend = join(root, 'frontend');

const flags = new Set(process.argv.slice(2));
const install = flags.has('--install');
const onlyBackend = flags.has('--be');
const onlyFrontend = flags.has('--fe');
const wantBackend = !onlyFrontend;
const wantFrontend = !onlyBackend;

// On Windows npm is a .cmd shim, which recent Node versions refuse to spawn
// without a shell. Every argument passed below is a literal in this file, so
// there is nothing for the shell to interpolate.
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const started = Date.now();
let step = 0;

/** Runs one npm command, and stops the whole build if it fails. */
function run(label, cwd, args) {
  step += 1;
  console.log(`\n[${step}] ${label}`);
  console.log(`    ${npm} ${args.join(' ')}  (in ${cwd.replace(root, '.')})`);

  // Windows takes the shell path with the whole command as one string, which is
  // what Node wants when `shell` is set; passing a separate argument array there
  // is deprecated because nothing escapes it. Everywhere else npm is executed
  // directly, with no shell involved at all.
  const result = isWindows
    ? spawnSync(`${npm} ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
    : spawnSync(npm, args, { cwd, stdio: 'inherit', shell: false });

  if (result.error) {
    fail(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${label} failed with exit code ${result.status}`);
  }
}

/** Confirms an artifact exists, naming the step that should have written it. */
function expect(path, producedBy) {
  if (!existsSync(path)) {
    fail(`${producedBy} reported success but ${path.replace(root, '.')} is missing`);
  }
  console.log(`    ok  ${path.replace(root, '.')}`);
}

function fail(message) {
  console.error(`\nBuild failed: ${message}`);
  process.exit(1);
}

if (wantBackend && !existsSync(join(backend, 'node_modules')) && !install) {
  fail('backend/node_modules is missing. Re-run with --install.');
}
if (wantFrontend && !existsSync(join(frontend, 'node_modules')) && !install) {
  fail('frontend/node_modules is missing. Re-run with --install.');
}

if (install && wantBackend) run('install backend', backend, ['ci']);
if (install && wantFrontend) run('install frontend', frontend, ['ci']);

if (wantBackend) {
  // The Prisma client is generated code, not a published package, so a clean
  // node_modules has no copy of it and `nest build` would fail to type-check.
  run('generate prisma client', backend, ['run', 'prisma:generate']);
  run('build backend', backend, ['run', 'build']);
}

if (wantFrontend) {
  run('build frontend', frontend, ['run', 'build']);
}

step += 1;
console.log(`\n[${step}] verify artifacts`);

if (wantBackend) {
  expect(join(backend, 'dist', 'src', 'main.js'), 'build backend');
  expect(join(backend, 'dist', 'src', 'app.module.js'), 'build backend');
}
if (wantFrontend) {
  expect(join(frontend, 'dist', 'frontend', 'browser', 'index.html'), 'build frontend');
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\nBuild complete in ${seconds}s`);
if (wantBackend) console.log('  backend   backend/dist/src/main.js       (node dist/src/main)');
if (wantFrontend) console.log('  frontend  frontend/dist/frontend/browser  (static root)');
