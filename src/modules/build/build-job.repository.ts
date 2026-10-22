/**
 * Persistence contract for the build queue and its artifacts.
 *
 * Every operation that must be atomic — enqueue without a second active build,
 * claim without two workers taking one job, complete with its artifacts and
 * retention — is one method, so the transaction stays in the persistence layer.
 */

import type { ArtifactName, BuildSourceFile } from './build-plan';

export const BUILD_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export const BUILD_FAILURE_REASONS = [
  'compile',
  'rejected',
  'timeout',
  'worker_error',
  'artifacts',
] as const;
export type BuildFailureReason = (typeof BUILD_FAILURE_REASONS)[number];

export interface BuildArtifactSummary {
  name: ArtifactName;
  flashOffset: number | null;
  sizeBytes: number;
  sha256: string;
}

export interface BuildJobSummary {
  id: string;
  projectId: string;
  status: BuildStatus;
  boardId: string;
  failureReason: BuildFailureReason | null;
  durationMs: number | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  artifacts: BuildArtifactSummary[];
}

export interface BuildJobDetail extends BuildJobSummary {
  log: string;
}

export interface EnqueueBuildInput {
  projectId: string;
  requestedBy: string;
  boardId: string;
  platform: string;
  platformBoard: string;
  files: readonly BuildSourceFile[];
  sourceHash: string;
}

export type EnqueueResult =
  | { created: true; job: BuildJobSummary }
  | { created: false; active: BuildJobSummary };

/** What the worker needs, and nothing that identifies the project or its owner. */
export interface ClaimedBuildJob {
  id: string;
  platform: string;
  platformBoard: string;
  files: BuildSourceFile[];
}

export interface BuildArtifactInput {
  name: ArtifactName;
  flashOffset: number | null;
  content: Buffer;
  sha256: string;
}

export interface CompleteBuildInput {
  status: 'succeeded' | 'failed';
  failureReason: BuildFailureReason | null;
  log: string;
  durationMs: number;
  artifacts: readonly BuildArtifactInput[];
}

export interface StaleBuildPolicy {
  /** A queued job older than this has no worker coming for it. */
  queuedBefore: Date;
  /** A running job whose lease ended before this lost its worker. */
  now: Date;
}

export abstract class BuildJobRepository {
  /**
   * Queues a build unless the project already has a queued or running one. The
   * check and the insert are serialized per project, so two clicks cannot start
   * two builds.
   */
  abstract enqueue(input: EnqueueBuildInput): Promise<EnqueueResult>;

  /** A succeeded build of exactly these sources whose artifacts are still kept. */
  abstract findReusable(
    projectId: string,
    sourceHash: string,
  ): Promise<BuildJobSummary | null>;

  /** Newest first. */
  abstract list(projectId: string, limit: number): Promise<BuildJobSummary[]>;

  abstract findDetail(
    projectId: string,
    buildId: string,
  ): Promise<BuildJobDetail | null>;

  abstract readArtifact(
    projectId: string,
    buildId: string,
    name: ArtifactName,
  ): Promise<Buffer | null>;

  /** Cancels a queued or running build; null when it is not active. */
  abstract cancel(
    projectId: string,
    buildId: string,
    now: Date,
  ): Promise<BuildJobSummary | null>;

  /** Marks abandoned builds failed with `timeout`, and drops their snapshots. */
  abstract expireStale(policy: StaleBuildPolicy): Promise<number>;

  /**
   * Takes the oldest queued build and marks it running until `leaseUntil`.
   * Concurrent workers never receive the same job.
   */
  abstract claimNext(
    now: Date,
    leaseUntil: Date,
  ): Promise<ClaimedBuildJob | null>;

  /** The platform a build targets, read from the job rather than from the worker. */
  abstract platformOf(buildId: string): Promise<string | null>;

  /**
   * Records the result of a running build. Returns false when the build is no
   * longer running (canceled or expired), and nothing is written. On success,
   * older builds of the project lose their artifacts and history beyond
   * `keepJobs` is deleted, in the same transaction.
   */
  abstract complete(
    buildId: string,
    result: CompleteBuildInput,
    now: Date,
    keepJobs: number,
  ): Promise<boolean>;
}
