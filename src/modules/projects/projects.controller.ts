import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../auth/supabase-auth.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import {
  CreateProjectDto,
  ProjectFilePathDto,
  SaveProjectFileDto,
  SaveProjectFilesDto,
} from './dto/project.dto';
import { ProjectFilesService } from './project-files.service';
import { ProjectsService } from './projects.service';

/**
 * Projects and their files, scoped to a workspace.
 *
 * Every handler resolves permission twice, and both are necessary:
 *
 *   1. `requireWorkspaceRole` — may this user act in this workspace, at this level?
 *   2. `requireInWorkspace`   — does this project actually live in that workspace?
 *
 * Without the second, a member of any workspace could reach any project by id.
 * Reads need `viewer`; writes need `editor`.
 */
@Controller('workspaces/:workspaceId/projects')
@UseGuards(SupabaseAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly files: ProjectFilesService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'viewer',
    );
    return this.projects.list(workspaceId);
  }

  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: CreateProjectDto,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    return this.projects.create(request.user.id, workspaceId, body);
  }

  @Delete(':projectId')
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'admin',
    );
    await this.projects.delete(workspaceId, projectId);
    return { deleted: true };
  }

  @Get(':projectId/files')
  async listFiles(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'viewer',
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
    return this.files.list(projectId);
  }

  @Get(':projectId/file')
  async readFile(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ProjectFilePathDto,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'viewer',
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
    return this.files.read(projectId, query.path);
  }

  @Put(':projectId/file')
  async saveFile(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: SaveProjectFileDto,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
    return this.files.save(projectId, body);
  }

  /** Autosave: only the files the editor marked dirty, in one request. */
  @Put(':projectId/files')
  async saveFiles(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: SaveProjectFilesDto,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
    return this.files.saveMany(projectId, body.files);
  }

  @Delete(':projectId/file')
  async deleteFile(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ProjectFilePathDto,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
    return this.files.delete(projectId, query.path);
  }
}
