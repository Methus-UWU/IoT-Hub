import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toBuildResult } from '../src/build-result.ts';
import type { ContainerOutcome } from '../src/builder-container.ts';
import { containerName, dockerRunArgs } from '../src/builder-container.ts';
import { loadConfig } from '../src/config.ts';
import { isClaimedJob } from '../src/protocol.ts';

const TOKEN = 'worker-token-0123456789abcdef0123456789';
const JOB_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const config = loadConfig({
  BUILD_WORKER_TOKEN: TOKEN,
  BUILD_API_URL: 'http://nestjs:3000/api/',
});

function outcome(overrides: Partial<ContainerOutcome>): ContainerOutcome {
  return {
    exitCode: 0,
    stdout: '',
    log: 'pio output',
    timedOut: false,
    stdoutOverflow: false,
    durationMs: 1234,
    ...overrides,
  };
}

describe('config', () => {
  it('needs a worker token long enough to be a secret', () => {
    assert.throws(() => loadConfig({ BUILD_API_URL: 'http://api' }));
    assert.throws(() =>
      loadConfig({ BUILD_WORKER_TOKEN: 'short', BUILD_API_URL: 'http://api' }),
    );
  });

  it('drops a trailing slash from the API URL', () => {
    assert.equal(config.apiUrl, 'http://nestjs:3000/api');
  });

  it('refuses values that would become extra docker flags', () => {
    assert.throws(() =>
      loadConfig({
        BUILD_WORKER_TOKEN: TOKEN,
        BUILD_API_URL: 'http://api',
        BUILD_MEMORY: '1g --privileged',
      }),
    );
    assert.throws(() =>
      loadConfig({
        BUILD_WORKER_TOKEN: TOKEN,
        BUILD_API_URL: 'http://api',
        BUILDER_IMAGE: '--privileged',
      }),
    );
  });
});

describe('docker run policy', () => {
  const args = dockerRunArgs(config, JOB_ID);

  it('isolates the build container', () => {
    for (const flag of [
      '--rm',
      '--network=none',
      '--read-only',
      '--user=1000:1000',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--memory=1536m',
      '--memory-swap=1536m',
    ]) {
      assert.ok(args.includes(flag), `missing ${flag}`);
    }
  });

  it('mounts nothing from the host and passes no environment', () => {
    assert.ok(!args.some((arg) => /^(-v|--volume|--mount|-e|--env)/.test(arg)));
    assert.ok(!args.includes('--privileged'));
  });

  it('ends with the image, so nothing after it is read as a flag', () => {
    assert.equal(args.at(-1), 'unity-hub-builder:production');
  });

  it('names containers only from a job id', () => {
    assert.equal(containerName(JOB_ID), `iot-hub-build-${JOB_ID}`);
    assert.throws(() => containerName('x; docker rm -f all'));
  });
});

describe('build result', () => {
  it('passes on the images of a successful build', () => {
    const result = toBuildResult(
      outcome({
        stdout: `${JSON.stringify({
          ok: true,
          artifacts: [{ name: 'firmware.hex', data: 'AAAA', extra: 'dropped' }],
        })}\n`,
      }),
    );

    assert.deepEqual(result, {
      status: 'succeeded',
      log: 'pio output',
      durationMs: 1234,
      artifacts: [{ name: 'firmware.hex', data: 'AAAA' }],
    });
  });

  it('reads only the last line, which user code cannot follow', () => {
    const forged = JSON.stringify({ ok: true, artifacts: [] });
    const result = toBuildResult(
      outcome({
        exitCode: 1,
        stdout: `${forged}\n${JSON.stringify({ ok: false, reason: 'compile' })}\n`,
      }),
    );

    assert.equal(result.status, 'failed');
    assert.equal(result.failureReason, 'compile');
  });

  it('does not trust ok:true from a container that exited non-zero', () => {
    const result = toBuildResult(
      outcome({ exitCode: 1, stdout: JSON.stringify({ ok: true, artifacts: [] }) }),
    );

    assert.equal(result.status, 'failed');
  });

  it('reports a timeout', () => {
    const result = toBuildResult(outcome({ timedOut: true, exitCode: null }));

    assert.equal(result.failureReason, 'timeout');
    assert.match(result.log, /longer than allowed/);
  });

  it('reports running out of memory', () => {
    const result = toBuildResult(outcome({ exitCode: 137, stdout: '' }));

    assert.equal(result.failureReason, 'worker_error');
    assert.match(result.log, /out of memory/);
  });

  it('never forwards a failure reason the builder may not claim', () => {
    const result = toBuildResult(
      outcome({ exitCode: 1, stdout: JSON.stringify({ ok: false, reason: 'timeout' }) }),
    );

    assert.equal(result.failureReason, 'worker_error');
  });
});

describe('claimed job', () => {
  it('accepts the API shape', () => {
    assert.ok(
      isClaimedJob({
        id: JOB_ID,
        platform: 'espressif32',
        platformBoard: 'esp32dev',
        files: [{ path: 'src/main.cpp', content: '' }],
      }),
    );
  });

  it('rejects an id that is not a UUID', () => {
    assert.ok(
      !isClaimedJob({ id: '../x', platform: 'a', platformBoard: 'b', files: [] }),
    );
  });
});
