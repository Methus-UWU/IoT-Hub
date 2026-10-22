import { setTimeout as sleep } from 'node:timers/promises';

import { BuildApiClient } from './api-client.ts';
import { toBuildResult } from './build-result.ts';
import { runBuilderContainer } from './builder-container.ts';
import { type DispatcherConfig, loadConfig } from './config.ts';
import type { BuildResult, ClaimedJob } from './protocol.ts';

/**
 * Firmware build dispatcher (docs/adr/ADR-002-build-isolation.md).
 *
 * Polls the API for queued builds and runs each in its own builder container.
 * It never compiles anything itself, never reads the database, and holds no
 * platform secret — only the worker token and the Docker socket.
 */

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

async function runJob(
  config: DispatcherConfig,
  api: BuildApiClient,
  job: ClaimedJob,
): Promise<void> {
  log(`build ${job.id} started (${job.platform}/${job.platformBoard}, ${job.files.length} files)`);

  let result: BuildResult;
  try {
    result = toBuildResult(await runBuilderContainer(config, job));
  } catch (error) {
    log(`build ${job.id} could not start a container: ${(error as Error).message}`);
    result = {
      status: 'failed',
      failureReason: 'worker_error',
      log: 'The build worker could not start a build container.\n',
      durationMs: 0,
    };
  }

  // A minute of compiling is worth a few retries; past that the API's lease
  // expires the build as timed out rather than leaving it running forever.
  let outcome: 'recorded' | 'discarded' | undefined;
  for (let attempt = 1; !outcome; attempt++) {
    try {
      outcome = await api.submit(job.id, result);
    } catch (error) {
      if (attempt >= 3) throw error;
      log(`build ${job.id} result not delivered (${(error as Error).message}), retrying`);
      await sleep(2_000 * attempt);
    }
  }
  log(`build ${job.id} ${result.status}${result.failureReason ? ` (${result.failureReason})` : ''}, ${outcome}`);
}

/** One worker slot: claim, build, report, repeat. Errors back off and retry. */
async function slot(
  config: DispatcherConfig,
  api: BuildApiClient,
  stopping: AbortSignal,
): Promise<void> {
  while (!stopping.aborted) {
    try {
      const job = await api.claim();
      if (job) {
        await runJob(config, api, job);
        continue;
      }
    } catch (error) {
      log(`dispatcher error: ${(error as Error).message}`);
    }
    await sleep(config.pollIntervalMs, undefined, { signal: stopping }).catch(
      () => undefined,
    );
  }
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const api = new BuildApiClient(config);
  const stopping = new AbortController();

  // Stop claiming on shutdown; a build already running finishes and reports.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      log(`${signal} received, finishing running builds`);
      stopping.abort();
    });
  }

  log(`dispatcher started: ${config.concurrency} slot(s), image ${config.builderImage}`);
  await Promise.all(
    Array.from({ length: config.concurrency }, () => slot(config, api, stopping.signal)),
  );
  log('dispatcher stopped');
}

main().catch((error: unknown) => {
  log(`dispatcher failed to start: ${(error as Error).message}`);
  process.exit(1);
});
