import { Injectable } from '@nestjs/common';

import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BuildArtifactSummary,
  BuildFailureReason,
  BuildJobDetail,
  BuildJobRepository,
  BuildJobSummary,
  BuildStatus,
  ClaimedBuildJob,
  CompleteBuildInput,
  EnqueueBuildInput,
  EnqueueResult,
  StaleBuildPolicy,
} from './build-job.repository';
import type { ArtifactName, BuildSourceFile } from './build-plan';

const ARTIFACT_SUMMARY_SELECT = {
  name: true,
  flashOffset: true,
  sizeBytes: true,
  sha256: true,
} as const;

const JOB_SUMMARY_SELECT = {
  id: true,
  projectId: true,
  status: true,
  boardId: true,
  failureReason: true,
  durationMs: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  artifacts: { select: ARTIFACT_SUMMARY_SELECT, orderBy: { name: 'asc' } },
} as const;

const ACTIVE: BuildStatus[] = ['queued', 'running'];

interface JobRow {
  id: string;
  projectId: string;
  status: string;
  boardId: string;
  failureReason: string | null;
  durationMs: number | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  artifacts: {
    name: string;
    flashOffset: number | null;
    sizeBytes: number;
    sha256: string;
  }[];
}

/** The CHECK constraints guarantee these strings; the casts only restate them. */
function toSummary(row: JobRow): BuildJobSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status as BuildStatus,
    boardId: row.boardId,
    failureReason: row.failureReason as BuildFailureReason | null,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    artifacts: row.artifacts.map((artifact): BuildArtifactSummary => ({
      ...artifact,
      name: artifact.name as ArtifactName,
    })),
  };
}

@Injectable()
export class PrismaBuildJobRepository extends BuildJobRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** Transactions use the primary even when ordinary reads use a replica. */
  private get primary(): Pick<PrismaClient, '$transaction'> {
    return this.prisma.db as Pick<PrismaClient, '$transaction'>;
  }

  enqueue(input: EnqueueBuildInput): Promise<EnqueueResult> {
    return this.primary.$transaction(async (tx) => {
      // Serializes enqueue per project without locking the project row, which
      // every file save also updates through the activity trigger.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`;

      const active = await tx.buildJob.findFirst({
        where: { projectId: input.projectId, status: { in: ACTIVE } },
        select: JOB_SUMMARY_SELECT,
      });
      if (active) return { created: false, active: toSummary(active) };

      const job = await tx.buildJob.create({
        data: {
          projectId: input.projectId,
          requestedBy: input.requestedBy,
          boardId: input.boardId,
          platform: input.platform,
          platformBoard: input.platformBoard,
          source: input.files.map(({ path, content }) => ({ path, content })),
          sourceHash: input.sourceHash,
        },
        select: JOB_SUMMARY_SELECT,
      });
      return { created: true, job: toSummary(job) };
    });
  }

  async findReusable(
    projectId: string,
    sourceHash: string,
  ): Promise<BuildJobSummary | null> {
    const job = await this.prisma.db.buildJob.findFirst({
      where: {
        projectId,
        sourceHash,
        status: 'succeeded',
        artifacts: { some: {} },
      },
      orderBy: { createdAt: 'desc' },
      select: JOB_SUMMARY_SELECT,
    });
    return job ? toSummary(job) : null;
  }

  async list(projectId: string, limit: number): Promise<BuildJobSummary[]> {
    const jobs = await this.prisma.db.buildJob.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: JOB_SUMMARY_SELECT,
    });
    return jobs.map(toSummary);
  }

  async findDetail(
    projectId: string,
    buildId: string,
  ): Promise<BuildJobDetail | null> {
    // Polled while a build runs; the primary avoids a replica showing a status
    // older than the one the client already saw.
    const job = await this.primary.$transaction((tx) =>
      tx.buildJob.findFirst({
        where: { id: buildId, projectId },
        select: { ...JOB_SUMMARY_SELECT, log: true },
      }),
    );
    return job ? { ...toSummary(job), log: job.log } : null;
  }

  async readArtifact(
    projectId: string,
    buildId: string,
    name: ArtifactName,
  ): Promise<Buffer | null> {
    const artifact = await this.prisma.db.buildArtifact.findFirst({
      where: { name, buildJob: { id: buildId, projectId } },
      select: { content: true },
    });
    return artifact ? Buffer.from(artifact.content) : null;
  }

  cancel(
    projectId: string,
    buildId: string,
    now: Date,
  ): Promise<BuildJobSummary | null> {
    return this.primary.$transaction(async (tx) => {
      const { count } = await tx.buildJob.updateMany({
        where: { id: buildId, projectId, status: { in: ACTIVE } },
        data: {
          status: 'canceled',
          finishedAt: now,
          leaseExpiresAt: null,
          source: Prisma.DbNull,
        },
      });
      if (count === 0) return null;

      const job = await tx.buildJob.findUniqueOrThrow({
        where: { id: buildId },
        select: JOB_SUMMARY_SELECT,
      });
      return toSummary(job);
    });
  }

  async expireStale(policy: StaleBuildPolicy): Promise<number> {
    const { count } = await this.prisma.db.buildJob.updateMany({
      where: {
        OR: [
          { status: 'queued', createdAt: { lt: policy.queuedBefore } },
          { status: 'running', leaseExpiresAt: { lt: policy.now } },
        ],
      },
      data: {
        status: 'failed',
        failureReason: 'timeout',
        finishedAt: policy.now,
        leaseExpiresAt: null,
        source: Prisma.DbNull,
      },
    });
    return count;
  }

  claimNext(now: Date, leaseUntil: Date): Promise<ClaimedBuildJob | null> {
    return this.primary.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        {
          id: string;
          platform: string;
          platform_board: string;
          source: unknown;
        }[]
      >`
        UPDATE "build_jobs"
        SET "status" = 'running', "started_at" = ${now}, "lease_expires_at" = ${leaseUntil}
        WHERE "id" = (
          SELECT "id" FROM "build_jobs"
          WHERE "status" = 'queued'
          ORDER BY "created_at"
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id", "platform", "platform_board", "source"
      `;
      if (!row) return null;

      return {
        id: row.id,
        platform: row.platform,
        platformBoard: row.platform_board,
        files: Array.isArray(row.source)
          ? (row.source as BuildSourceFile[])
          : [],
      };
    });
  }

  async platformOf(buildId: string): Promise<string | null> {
    const job = await this.primary.$transaction((tx) =>
      tx.buildJob.findUnique({
        where: { id: buildId },
        select: { platform: true },
      }),
    );
    return job?.platform ?? null;
  }

  complete(
    buildId: string,
    result: CompleteBuildInput,
    now: Date,
    keepJobs: number,
  ): Promise<boolean> {
    return this.primary.$transaction(async (tx) => {
      const { count } = await tx.buildJob.updateMany({
        where: { id: buildId, status: 'running' },
        data: {
          status: result.status,
          failureReason: result.failureReason,
          log: result.log,
          durationMs: result.durationMs,
          finishedAt: now,
          leaseExpiresAt: null,
          source: Prisma.DbNull,
        },
      });
      if (count === 0) return false;

      if (result.artifacts.length > 0) {
        await tx.buildArtifact.createMany({
          data: result.artifacts.map((artifact) => ({
            buildJobId: buildId,
            name: artifact.name,
            flashOffset: artifact.flashOffset,
            sizeBytes: artifact.content.length,
            sha256: artifact.sha256,
            content: new Uint8Array(artifact.content),
          })),
        });
      }

      const { projectId } = await tx.buildJob.findUniqueOrThrow({
        where: { id: buildId },
        select: { projectId: true },
      });

      if (result.status === 'succeeded') {
        // Only the newest image of a project is worth keeping: it is what the
        // user flashes, and an identical rebuild reuses it.
        await tx.buildArtifact.deleteMany({
          where: { buildJob: { projectId, id: { not: buildId } } },
        });
      }

      const expired = await tx.buildJob.findMany({
        where: { projectId, status: { notIn: ACTIVE } },
        orderBy: { createdAt: 'desc' },
        skip: keepJobs,
        select: { id: true },
      });
      if (expired.length > 0) {
        await tx.buildJob.deleteMany({
          where: { id: { in: expired.map((job) => job.id) } },
        });
      }

      return true;
    });
  }
}
