import { Injectable, NotFoundException } from '@nestjs/common';

import { CreateProjectDto } from './dto/project.dto';
import { Project, ProjectRepository } from './project.repository';

/**
 * Project lifecycle inside a workspace.
 *
 * Authorization happens in the controller, which resolves workspace membership
 * before any of this runs.
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly projects: ProjectRepository) {}

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

  async create(workspaceId: string, body: CreateProjectDto): Promise<Project> {
    const name = body.name.trim();
    const slug = await this.uniqueSlug(workspaceId, name);

    return this.projects.create({
      workspaceId,
      name,
      slug,
      description: body.description?.trim(),
      board: body.board?.trim(),
      framework: body.framework?.trim(),
    });
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
