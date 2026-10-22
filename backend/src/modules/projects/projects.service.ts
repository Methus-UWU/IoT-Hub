import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { EntitlementService } from '../billing/entitlement.service';
import { findBoard } from './board-catalog';
import { findDevice } from './catalog/device-catalog';
import { ProjectComponentsService } from './project-components.service';
import { starterFilesFor } from './project-starter-files';
import { CreateProjectDto } from './dto/project.dto';
import {
  Project,
  ProjectComponent,
  ProjectComponentRepository,
  ProjectRepository,
} from './project.repository';

/**
 * Project lifecycle inside a workspace.
 *
 * Authorization happens in the controller, which resolves workspace membership
 * before any of this runs.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly components: ProjectComponentRepository,
    private readonly componentsService: ProjectComponentsService,
    private readonly entitlements: EntitlementService,
  ) {}

  list(workspaceId: string): Promise<Project[]> {
    return this.projects.listForWorkspace(workspaceId);
  }

  /**
   * Resolves a project and confirms it belongs to the workspace the caller was
   * authorized against.
   *
   * This is the check that stops a member of workspace A from reaching a project in
   * workspace B by guessing its id: membership alone is not enough, the project must
   * also live where the caller has rights. A mismatch is reported as absent, so the
   * id cannot be confirmed to exist.
   */
  async requireInWorkspace(
    workspaceId: string,
    projectId: string,
  ): Promise<Project> {
    const project = await this.projects.findById(projectId);

    if (!project || project.workspaceId !== workspaceId) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }

    return project;
  }

  /**
   * The plan check runs before the write, and throws rather than returning a
   * flag, so no caller can create a project past the ceiling by forgetting to
   * look at a boolean.
   */
  async create(
    userId: string,
    workspaceId: string,
    body: CreateProjectDto,
  ): Promise<Project & { components: ProjectComponent[] }> {
    await this.entitlements.assertCanCreateProject(userId);

    const board = findBoard(body.boardId);
    if (!board || !findDevice(board.id)?.isBoard) {
      throw new NotFoundException({
        code: 'BOARD_NOT_FOUND',
        message: 'Unknown board definition',
      });
    }

    const name = body.name.trim();
    const framework = body.framework?.trim() || board.defaultFramework;
    if (!name || !board.frameworks.includes(framework)) {
      throw new BadRequestException({
        code: 'INVALID_PROJECT_SETUP',
        message:
          'Enter a project name and choose a framework the board supports',
      });
    }
    const deviceIds = body.deviceIds ?? [];
    const devices = await this.componentsService.initialDevicePlacements(
      userId,
      deviceIds,
    );
    const slug = await this.uniqueSlug(workspaceId, name);

    // Project, board and starter files commit together. A project that opened
    // to an empty canvas after the user had already picked a board is the exact
    // failure this flow exists to prevent.
    const created = await this.components.createProjectWithBoard(
      {
        workspaceId,
        name,
        slug,
        description: body.description?.trim(),
        board: board.name,
        framework,
      },
      this.componentsService.boardPlacement(board.id, board.name),
      devices,
      starterFilesFor(board, framework, deviceIds),
    );

    return { ...created.project, components: created.components };
  }

  async delete(workspaceId: string, projectId: string): Promise<void> {
    await this.requireInWorkspace(workspaceId, projectId);
    await this.projects.delete(projectId);
  }

  /**
   * Slugs are unique per workspace. The suffix loop is a convenience; the unique
   * index is what actually guarantees uniqueness under concurrent creates, and the
   * repository turns that violation into a clear conflict.
   */
  private async uniqueSlug(workspaceId: string, name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'project';

    let candidate = base;
    for (let suffix = 2; suffix < 50; suffix++) {
      if (!(await this.projects.slugExists(workspaceId, candidate))) {
        return candidate;
      }
      candidate = `${base.slice(0, 36)}-${suffix}`;
    }

    return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
  }
}
