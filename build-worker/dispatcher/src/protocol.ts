/**
 * The two contracts the dispatcher sits between: the API's worker routes
 * (backend/src/modules/build/build-worker.controller.ts) and the builder's
 * stdin/stdout (build-worker/builder/build.py).
 */

export interface SourceFile {
  path: string;
  content: string;
}

/** POST /internal/build-jobs/claim */
export interface ClaimedJob {
  id: string;
  platform: string;
  platformBoard: string;
  files: SourceFile[];
}

export type FailureReason =
  | 'compile'
  | 'rejected'
  | 'timeout'
  | 'worker_error'
  | 'artifacts';

/** POST /internal/build-jobs/:id/result */
export interface BuildResult {
  status: 'succeeded' | 'failed';
  failureReason?: FailureReason;
  log: string;
  durationMs: number;
  artifacts?: { name: string; data: string }[];
}

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isClaimedJob(value: unknown): value is ClaimedJob {
  if (typeof value !== 'object' || value === null) return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.id === 'string' &&
    JOB_ID.test(job.id) &&
    typeof job.platform === 'string' &&
    typeof job.platformBoard === 'string' &&
    Array.isArray(job.files) &&
    job.files.every(
      (file: unknown) =>
        typeof file === 'object' &&
        file !== null &&
        typeof (file as SourceFile).path === 'string' &&
        typeof (file as SourceFile).content === 'string',
    )
  );
}
