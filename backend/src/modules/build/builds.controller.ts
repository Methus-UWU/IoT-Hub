import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { THROTTLE_OVERRIDES } from '../../common/config/security.config';
import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../auth/supabase-auth.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { ProjectsService } from '../projects/projects.service';
import type { WorkspaceRole } from '../workspaces/workspace-role';
import { BuildsService } from './builds.service';

/**
 * Firmware builds of one project.
 *
 * Same double check as the project routes: the caller's workspace role, then
 * that the project lives in that workspace. Requesting or canceling a build
 * spends the workspace's build minutes, so it needs `editor`; reading a build
 * and downloading its image need `viewer`.
 */
@Controller('workspaces/:workspaceId/projects/:projectId/builds')
@UseGuards(SupabaseAuthGuard)
export class BuildsController {
  constructor(
    private readonly builds: BuildsService,
    private readonly projects: ProjectsService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** 202: the build is queued, not done. Poll `GET :buildId` for its status. */
  @Throttle(THROTTLE_OVERRIDES.build)
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async request(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    const project = await this.authorize(
      request,
      workspaceId,
      projectId,
      'editor',
    );
    return this.builds.request(request.user.id, project);
  }

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.authorize(request, workspaceId, projectId, 'viewer');
    return this.builds.list(projectId);
  }

  @Get(':buildId')
  async get(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('buildId', ParseUUIDPipe) buildId: string,
  ) {
    await this.authorize(request, workspaceId, projectId, 'viewer');
    return this.builds.get(projectId, buildId);
  }

  @Post(':buildId/cancel')
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('buildId', ParseUUIDPipe) buildId: string,
  ) {
    await this.authorize(request, workspaceId, projectId, 'editor');
    return this.builds.cancel(projectId, buildId);
  }

  @Get(':buildId/artifacts/:name')
  async artifact(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('buildId', ParseUUIDPipe) buildId: string,
    @Param('name') name: string,
  ): Promise<StreamableFile> {
    await this.authorize(request, workspaceId, projectId, 'viewer');
    const artifact = await this.builds.artifact(projectId, buildId, name);
    return new StreamableFile(artifact.content, {
      type: 'application/octet-stream',
      // The name is one of ARTIFACT_NAMES by now, so it is safe in a header.
      disposition: `attachment; filename="${artifact.name}"`,
      length: artifact.content.length,
    });
  }

  private async authorize(
    request: AuthenticatedRequest,
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      role,
    );
    return this.projects.requireInWorkspace(workspaceId, projectId);
  }
}
