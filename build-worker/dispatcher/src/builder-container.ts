import { spawn } from 'node:child_process';

import type { DispatcherConfig } from './config.ts';
import type { ClaimedJob } from './protocol.ts';

/**
 * One build in one throwaway container.
 *
 * The container gets the sources on stdin and nothing else: no network, no
 * capabilities, no writable root, no host mounts, no environment from this
 * process. Its output is bounded here because the code producing it is the
 * user's.
 */

export interface ContainerOutcome {
  /** null when the container was killed for running too long. */
  exitCode: number | null;
  stdout: string;
  /** The tail of stderr: the build log. */
  log: string;
  timedOut: boolean;
  /** stdout grew past the cap; the result line cannot be trusted. */
  stdoutOverflow: boolean;
  durationMs: number;
}

const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_LOG_BYTES = 256 * 1024;

export function containerName(jobId: string): string {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error('Unexpected job id');
  return `iot-hub-build-${jobId}`;
}

/** `docker run` arguments, apart from the spawn so the policy is testable. */
export function dockerRunArgs(
  config: DispatcherConfig,
  jobId: string,
): string[] {
  return [
    'run',
    '--rm',
    '--interactive',
    '--name',
    containerName(jobId),
    '--network=none',
    '--read-only',
    '--user=1000:1000',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--memory=${config.memory}`,
    `--memory-swap=${config.memory}`,
    `--cpus=${config.cpus}`,
    `--pids-limit=${config.pidsLimit}`,
    '--ulimit=nofile=1024:1024',
    `--tmpfs=/workspace:rw,nosuid,nodev,size=${config.workspaceSize},uid=1000,gid=1000,mode=0700`,
    `--tmpfs=/tmp:rw,nosuid,nodev,size=${config.tmpSize},uid=1000,gid=1000,mode=0700`,
    '--log-driver=none',
    '--label=iot-hub.build=true',
    config.builderImage,
  ];
}

/** Keeps the last `limit` bytes: the part of a build log that holds the verdict. */
class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.chunks.length > 1 && this.size - this.chunks[0].length >= this.limit) {
      this.size -= this.chunks.shift()!.length;
    }
  }

  toString(): string {
    const all = Buffer.concat(this.chunks);
    return all.subarray(Math.max(0, all.length - this.limit)).toString('utf8');
  }
}

/** Only what the Docker CLI needs to reach the daemon; nothing else of ours. */
function dockerEnvironment(): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
  };
}

export function killContainer(jobId: string): void {
  // The CLI exiting does not stop the container; the daemon must be told.
  spawn('docker', ['kill', containerName(jobId)], {
    stdio: 'ignore',
    env: dockerEnvironment(),
  }).on('error', () => undefined);
}

export function runBuilderContainer(
  config: DispatcherConfig,
  job: ClaimedJob,
): Promise<ContainerOutcome> {
  const started = Date.now();
  const request = JSON.stringify({
    target: { platform: job.platform, board: job.platformBoard },
    files: job.files,
  });

  return new Promise((resolve, reject) => {
    const child = spawn('docker', dockerRunArgs(config, job.id), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: dockerEnvironment(),
    });

    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stdoutOverflow = false;
    const log = new TailBuffer(MAX_LOG_BYTES);
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killContainer(job.id);
    }, config.buildTimeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        if (!stdoutOverflow) killContainer(job.id);
        stdoutOverflow = true;
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => log.push(chunk));

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? null : code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        log: log.toString(),
        timedOut,
        stdoutOverflow,
        durationMs: Date.now() - started,
      });
    });

    child.stdin.on('error', () => undefined);
    child.stdin.end(request);
  });
}
