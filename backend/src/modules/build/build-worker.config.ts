import { Logger } from '@nestjs/common';

/**
 * The build dispatcher's credential.
 *
 * It is deliberately narrow: it can claim a queued build and report its result,
 * and nothing else. The dispatcher holds this instead of a database URL or a
 * Supabase key, because it also holds the Docker socket.
 *
 * Builds are off until it is set — queuing a build no worker can authenticate
 * for would leave the user watching a spinner that never ends.
 */

const MIN_TOKEN_LENGTH = 32;
const logger = new Logger('BuildWorkerConfig');
let warned = false;

export function buildWorkerToken(): string | null {
  const token = process.env.BUILD_WORKER_TOKEN?.trim();
  if (!token) return null;
  if (token.length < MIN_TOKEN_LENGTH) {
    if (!warned) {
      warned = true;
      logger.warn(
        `BUILD_WORKER_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters; firmware builds stay disabled.`,
      );
    }
    return null;
  }
  return token;
}

export function buildsEnabled(): boolean {
  return buildWorkerToken() !== null;
}

/** How long a build may wait for a worker before it is reported as timed out. */
export const BUILD_QUEUE_TIMEOUT_MS = 15 * 60_000;

/**
 * How long a claimed build may run before it is presumed lost. Longer than the
 * dispatcher's own container timeout, so a slow build is killed by the
 * dispatcher, not raced by this.
 */
export const BUILD_LEASE_MS = 10 * 60_000;

/** Finished builds kept per project, newest first. */
export const BUILD_HISTORY_PER_PROJECT = 20;

/** The log tail kept for a build, in characters. Matches the table's CHECK. */
export const BUILD_LOG_LIMIT = 65_536;

/** Largest single image accepted from a worker. Matches the table's CHECK. */
export const BUILD_ARTIFACT_LIMIT_BYTES = 8 * 1024 * 1024;
