import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { EntitlementService } from '../billing/entitlement.service';
import {
  FlashMethod,
  findBoard,
  findBoardByIdOrName,
} from '../projects/board-catalog';
import { findBoard as findBoardComponent } from '../projects/pin-assignment';
import { ProjectCircuitService } from '../projects/project-circuit.service';
import { ProjectFilesService } from '../projects/project-files.service';
import type { Project } from '../projects/project.repository';
import { BuildJobRepository, BuildJobSummary } from './build-job.repository';
import { ARTIFACT_NAMES, ArtifactName, planBuild } from './build-plan';
import { BUILD_QUEUE_TIMEOUT_MS, buildsEnabled } from './build-worker.config';

/** Builds shown in a project's history. */
const LIST_LIMIT = 10;

export interface BuildResponse extends Omit<BuildJobSummary, 'projectId'> {
  /** How the browser flashes this build; null when it cannot. */
  flash: FlashMethod | null;
  log?: string;
}

/**
 * Firmware builds as the user sees them: request, watch, cancel, download.
 *
 * Authorization is the controller's: every method assumes the caller has the
 * right workspace role and that the project belongs to that workspace.
 */
@Injectable()
export class BuildsService {
  constructor(
    private readonly jobs: BuildJobRepository,
    private readonly files: ProjectFilesService,
    private readonly circuits: ProjectCircuitService,
    private readonly entitlements: EntitlementService,
  ) {}

  /**
   * Queues a build of the project as it is stored now.
   *
   * Identical sources whose image is still kept return that build instead of
   * compiling again, and cost no build minutes. A project allows one active
   * build at a time.
   */
  async request(
    userId: string,
    project: Project,
  ): Promise<{ build: BuildResponse; reused: boolean }> {
    if (!buildsEnabled()) {
      throw new ServiceUnavailableException({
        code: 'BUILD_WORKER_NOT_CONFIGURED',
        message: 'Firmware builds are not enabled on this server.',
      });
    }

    const [boardId, files] = await Promise.all([
      this.boardIdOf(project),
      this.files.readAll(project.id),
    ]);
    const plan = planBuild(
      { board: boardId, framework: project.framework },
      files,
    );

    const reusable = await this.jobs.findReusable(project.id, plan.sourceHash);
    if (reusable) return { build: this.toResponse(reusable), reused: true };

    await this.entitlements.assertCanStartBuild(userId);
    await this.expireStale();

    const result = await this.jobs.enqueue({
      projectId: project.id,
      requestedBy: userId,
      ...plan,
    });
    if (!result.created) {
      throw new ConflictException({
        code: 'BUILD_ALREADY_ACTIVE',
        message: 'This project is already building.',
        buildId: result.active.id,
      });
    }

    return { build: this.toResponse(result.job), reused: false };
  }

  async list(projectId: string): Promise<BuildResponse[]> {
    const jobs = await this.jobs.list(projectId, LIST_LIMIT);
    return jobs.map((job) => this.toResponse(job));
  }

  async get(projectId: string, buildId: string): Promise<BuildResponse> {
    // A build nobody will run must not look queued forever to the client
    // polling it, so the read applies the same expiry the queue does.
    await this.expireStale();
    const job = await this.jobs.findDetail(projectId, buildId);
    if (!job) throw this.notFound();
    return { ...this.toResponse(job), log: job.log };
  }

  async cancel(projectId: string, buildId: string): Promise<BuildResponse> {
    const job = await this.jobs.cancel(projectId, buildId, new Date());
    if (job) return this.toResponse(job);

    // Distinguish "not yours or not there" from "already finished".
    if (!(await this.jobs.findDetail(projectId, buildId)))
      throw this.notFound();
    throw new ConflictException({
      code: 'BUILD_NOT_ACTIVE',
      message: 'This build has already finished.',
    });
  }

  async artifact(
    projectId: string,
    buildId: string,
    name: string,
  ): Promise<{ name: ArtifactName; content: Buffer }> {
    const known = ARTIFACT_NAMES.find((candidate) => candidate === name);
    const content =
      known && (await this.jobs.readArtifact(projectId, buildId, known));
    if (!known || !content) {
      throw new NotFoundException({
        code: 'BUILD_ARTIFACT_NOT_FOUND',
        message: 'This firmware image is no longer available. Build again.',
      });
    }
    return { name: known, content };
  }

  /**
   * The board to build for. `projects.board` holds the display name chosen at
   * creation, so the board component on the canvas — which carries the catalog id
   * and is what the user actually wired — decides. The stored name is the fallback
   * for a project whose canvas has no board.
   */
  private async boardIdOf(project: Project): Promise<string> {
    const circuit = await this.circuits.load(project.id);
    const component = findBoardComponent(circuit);
    if (component) return component.definitionId;
    return findBoardByIdOrName(project.board)?.id ?? project.board;
  }

  private async expireStale(): Promise<void> {
    const now = new Date();
    await this.jobs.expireStale({
      now,
      queuedBefore: new Date(now.getTime() - BUILD_QUEUE_TIMEOUT_MS),
    });
  }

  private toResponse(job: BuildJobSummary): BuildResponse {
    return {
      id: job.id,
      status: job.status,
      boardId: job.boardId,
      failureReason: job.failureReason,
      durationMs: job.durationMs,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      artifacts: job.artifacts,
      flash: findBoard(job.boardId)?.flash ?? null,
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'BUILD_NOT_FOUND',
      message: 'Build not found',
    });
  }
}
