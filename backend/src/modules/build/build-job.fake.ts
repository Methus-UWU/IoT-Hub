import { randomUUID } from 'node:crypto';

import {
  BuildJobDetail,
  BuildJobRepository,
  BuildJobSummary,
  ClaimedBuildJob,
  CompleteBuildInput,
  EnqueueBuildInput,
  EnqueueResult,
  StaleBuildPolicy,
} from './build-job.repository';
import type { ArtifactName, BuildSourceFile } from './build-plan';

interface Row extends BuildJobDetail {
  platform: string;
  platformBoard: string;
  sourceHash: string;
  source: BuildSourceFile[] | null;
  leaseExpiresAt: Date | null;
  contents: Map<string, Buffer>;
}

/**
 * In-memory build queue with the same rules the Prisma repository enforces in
 * SQL, for service tests. Test-only; never bound in a module.
 */
export class FakeBuildJobRepository extends BuildJobRepository {
  readonly rows: Row[] = [];
  private clock = 0;

  private summary(row: Row): BuildJobSummary {
    return {
      id: row.id,
      projectId: row.projectId,
      status: row.status,
      boardId: row.boardId,
      failureReason: row.failureReason,
      durationMs: row.durationMs,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      artifacts: row.artifacts.map((artifact) => ({ ...artifact })),
    };
  }

  private active(row: Row): boolean {
    return row.status === 'queued' || row.status === 'running';
  }

  enqueue(input: EnqueueBuildInput): Promise<EnqueueResult> {
    const active = this.rows.find(
      (row) => row.projectId === input.projectId && this.active(row),
    );
    if (active) {
      return Promise.resolve({ created: false, active: this.summary(active) });
    }

    const row: Row = {
      id: randomUUID(),
      projectId: input.projectId,
      status: 'queued',
      boardId: input.boardId,
      platform: input.platform,
      platformBoard: input.platformBoard,
      sourceHash: input.sourceHash,
      source: input.files.map((file) => ({ ...file })),
      failureReason: null,
      durationMs: null,
      // Strictly increasing, so "oldest first" is deterministic in tests.
      createdAt: new Date(Date.now() + this.clock++),
      startedAt: null,
      finishedAt: null,
      leaseExpiresAt: null,
      log: '',
      artifacts: [],
      contents: new Map(),
    };
    this.rows.push(row);
    return Promise.resolve({ created: true, job: this.summary(row) });
  }

  findReusable(
    projectId: string,
    sourceHash: string,
  ): Promise<BuildJobSummary | null> {
    const row = [...this.rows]
      .reverse()
      .find(
        (candidate) =>
          candidate.projectId === projectId &&
          candidate.sourceHash === sourceHash &&
          candidate.status === 'succeeded' &&
          candidate.artifacts.length > 0,
      );
    return Promise.resolve(row ? this.summary(row) : null);
  }

  list(projectId: string, limit: number): Promise<BuildJobSummary[]> {
    return Promise.resolve(
      [...this.rows]
        .reverse()
        .filter((row) => row.projectId === projectId)
        .slice(0, limit)
        .map((row) => this.summary(row)),
    );
  }

  findDetail(
    projectId: string,
    buildId: string,
  ): Promise<BuildJobDetail | null> {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === buildId && candidate.projectId === projectId,
    );
    return Promise.resolve(row ? { ...this.summary(row), log: row.log } : null);
  }

  readArtifact(
    projectId: string,
    buildId: string,
    name: ArtifactName,
  ): Promise<Buffer | null> {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === buildId && candidate.projectId === projectId,
    );
    return Promise.resolve(row?.contents.get(name) ?? null);
  }

  cancel(
    projectId: string,
    buildId: string,
    now: Date,
  ): Promise<BuildJobSummary | null> {
    const row = this.rows.find(
      (candidate) =>
        candidate.id === buildId &&
        candidate.projectId === projectId &&
        this.active(candidate),
    );
    if (!row) return Promise.resolve(null);
    Object.assign(row, {
      status: 'canceled',
      finishedAt: now,
      leaseExpiresAt: null,
      source: null,
    });
    return Promise.resolve(this.summary(row));
  }

  expireStale(policy: StaleBuildPolicy): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      const abandoned =
        (row.status === 'queued' && row.createdAt < policy.queuedBefore) ||
        (row.status === 'running' &&
          row.leaseExpiresAt !== null &&
          row.leaseExpiresAt < policy.now);
      if (!abandoned) continue;
      Object.assign(row, {
        status: 'failed',
        failureReason: 'timeout',
        finishedAt: policy.now,
        leaseExpiresAt: null,
        source: null,
      });
      count++;
    }
    return Promise.resolve(count);
  }

  claimNext(now: Date, leaseUntil: Date): Promise<ClaimedBuildJob | null> {
    const row = this.rows.find((candidate) => candidate.status === 'queued');
    if (!row) return Promise.resolve(null);
    Object.assign(row, {
      status: 'running',
      startedAt: now,
      leaseExpiresAt: leaseUntil,
    });
    return Promise.resolve({
      id: row.id,
      platform: row.platform,
      platformBoard: row.platformBoard,
      files: row.source ?? [],
    });
  }

  platformOf(buildId: string): Promise<string | null> {
    return Promise.resolve(
      this.rows.find((row) => row.id === buildId)?.platform ?? null,
    );
  }

  complete(
    buildId: string,
    result: CompleteBuildInput,
    now: Date,
    keepJobs: number,
  ): Promise<boolean> {
    const row = this.rows.find(
      (candidate) => candidate.id === buildId && candidate.status === 'running',
    );
    if (!row) return Promise.resolve(false);

    Object.assign(row, {
      status: result.status,
      failureReason: result.failureReason,
      log: result.log,
      durationMs: result.durationMs,
      finishedAt: now,
      leaseExpiresAt: null,
      source: null,
    });
    row.artifacts = result.artifacts.map((artifact) => ({
      name: artifact.name,
      flashOffset: artifact.flashOffset,
      sizeBytes: artifact.content.length,
      sha256: artifact.sha256,
    }));
    for (const artifact of result.artifacts) {
      row.contents.set(artifact.name, artifact.content);
    }

    if (result.status === 'succeeded') {
      for (const other of this.rows) {
        if (other.projectId !== row.projectId || other.id === row.id) continue;
        other.artifacts = [];
        other.contents.clear();
      }
    }

    const finished = [...this.rows]
      .reverse()
      .filter(
        (other) => other.projectId === row.projectId && !this.active(other),
      );
    for (const expired of finished.slice(keepJobs)) {
      this.rows.splice(this.rows.indexOf(expired), 1);
    }
    return Promise.resolve(true);
  }
}
