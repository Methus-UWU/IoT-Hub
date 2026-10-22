/**
 * Dispatcher settings, read once from the environment.
 *
 * The dispatcher's only credential is BUILD_WORKER_TOKEN. It must never be given
 * DATABASE_URL, a Supabase key, or an AI key: it holds the Docker socket, and
 * the less it can reach, the less a container escape is worth.
 */

export interface DispatcherConfig {
  /** API base including the global prefix, e.g. http://nestjs:3000/api */
  readonly apiUrl: string;
  readonly workerToken: string;
  readonly builderImage: string;
  readonly concurrency: number;
  readonly pollIntervalMs: number;
  readonly buildTimeoutMs: number;
  readonly memory: string;
  readonly cpus: string;
  readonly pidsLimit: number;
  readonly workspaceSize: string;
  readonly tmpSize: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(
  env: Environment,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

/** Docker size and CPU values; anything else would be passed straight to `docker run`. */
function dockerQuantity(
  env: Environment,
  name: string,
  fallback: string,
  pattern: RegExp,
): string {
  const value = env[name]?.trim() || fallback;
  if (!pattern.test(value)) throw new Error(`${name} has an invalid value`);
  return value;
}

const SIZE = /^\d{1,6}[kmg]$/;
const CPUS = /^\d{1,2}(\.\d{1,2})?$/;

export function loadConfig(env: Environment): DispatcherConfig {
  const workerToken = required(env, 'BUILD_WORKER_TOKEN');
  if (workerToken.length < 32) {
    throw new Error('BUILD_WORKER_TOKEN must be at least 32 characters');
  }

  const apiUrl = required(env, 'BUILD_API_URL').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(apiUrl)) {
    throw new Error('BUILD_API_URL must be an http(s) URL');
  }

  return {
    apiUrl,
    workerToken,
    builderImage: dockerQuantity(
      env,
      'BUILDER_IMAGE',
      'unity-hub-builder:production',
      /^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?(@sha256:[a-f0-9]{64})?$/,
    ),
    concurrency: integer(env, 'BUILD_CONCURRENCY', 1, 1, 8),
    pollIntervalMs: integer(env, 'BUILD_POLL_INTERVAL_MS', 3_000, 500, 60_000),
    buildTimeoutMs: integer(env, 'BUILD_TIMEOUT_MS', 300_000, 30_000, 540_000),
    memory: dockerQuantity(env, 'BUILD_MEMORY', '1536m', SIZE),
    cpus: dockerQuantity(env, 'BUILD_CPUS', '1', CPUS),
    pidsLimit: integer(env, 'BUILD_PIDS_LIMIT', 256, 32, 4096),
    workspaceSize: dockerQuantity(env, 'BUILD_WORKSPACE_SIZE', '768m', SIZE),
    tmpSize: dockerQuantity(env, 'BUILD_TMP_SIZE', '512m', SIZE),
  };
}
