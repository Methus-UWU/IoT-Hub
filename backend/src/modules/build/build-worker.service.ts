import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

import {
  BuildArtifactInput,
  BuildFailureReason,
  BuildJobRepository,
  ClaimedBuildJob,
} from './build-job.repository';
import { flashLayoutFor } from './build-plan';
import {
  BUILD_ARTIFACT_LIMIT_BYTES,
  BUILD_HISTORY_PER_PROJECT,
  BUILD_LEASE_MS,
  BUILD_LOG_LIMIT,
  BUILD_QUEUE_TIMEOUT_MS,
} from './build-worker.config';
import { WorkerBuildResultDto } from './dto/build.dto';

/**
 * The dispatcher's side of the queue: take a job, hand back a result.
 *
 * A result is treated as untrusted data. The dispatcher is authenticated, but the
 * images and the log it forwards were produced inside a container running user
 * code, so a "succeeded" result is accepted only with exactly the images its
 * platform flashes, and the flash offsets come from the API, never from it.
 */
@Injectable()
export class BuildWorkerService {
  constructor(private readonly jobs: BuildJobRepository) {}

  async claim(): Promise<ClaimedBuildJob | null> {
    const now = new Date();
    await this.jobs.expireStale({
      now,
      queuedBefore: new Date(now.getTime() - BUILD_QUEUE_TIMEOUT_MS),
    });
    return this.jobs.claimNext(now, new Date(now.getTime() + BUILD_LEASE_MS));
  }

  async complete(buildId: string, result: WorkerBuildResultDto): Promise<void> {
    const platform = await this.jobs.platformOf(buildId);
    if (!platform) {
      throw new NotFoundException({
        code: 'BUILD_NOT_FOUND',
        message: 'Build not found',
      });
    }

    const outcome = this.verify(platform, result);
    const recorded = await this.jobs.complete(
      buildId,
      {
        ...outcome,
        log: tail(result.log, BUILD_LOG_LIMIT),
        durationMs: result.durationMs,
      },
      new Date(),
      BUILD_HISTORY_PER_PROJECT,
    );

    if (!recorded) {
      throw new ConflictException({
        code: 'BUILD_NOT_RUNNING',
        message:
          'This build was canceled or timed out; its result was discarded.',
      });
    }
  }

  private verify(
    platform: string,
    result: WorkerBuildResultDto,
  ): {
    status: 'succeeded' | 'failed';
    failureReason: BuildFailureReason | null;
    artifacts: BuildArtifactInput[];
  } {
    if (result.status === 'failed') {
      return {
        status: 'failed',
        failureReason: result.failureReason ?? 'worker_error',
        artifacts: [],
      };
    }

    const layout = flashLayoutFor(platform);
    const received = new Map(
      (result.artifacts ?? []).map((artifact) => [
        artifact.name,
        artifact.data,
      ]),
    );
    const complete =
      layout.length > 0 &&
      received.size === layout.length &&
      layout.every((image) => received.has(image.name));

    const artifacts = complete
      ? layout.map((image): BuildArtifactInput => {
          const content = Buffer.from(received.get(image.name)!, 'base64');
          return {
            name: image.name,
            flashOffset: image.offset,
            content,
            sha256: createHash('sha256').update(content).digest('hex'),
          };
        })
      : [];

    const acceptable =
      complete &&
      artifacts.every(
        (artifact) =>
          artifact.content.length > 0 &&
          artifact.content.length <= BUILD_ARTIFACT_LIMIT_BYTES,
      );

    return acceptable
      ? { status: 'succeeded', failureReason: null, artifacts }
      : { status: 'failed', failureReason: 'artifacts', artifacts: [] };
  }
}

/** The end of a build log is where the compiler's verdict is. */
function tail(log: string, limit: number): string {
  if (log.length <= limit) return log;
  const marker = '…(earlier output trimmed)\n';
  return marker + log.slice(log.length - (limit - marker.length));
}
