import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { EntitlementService } from '../billing/entitlement.service';
import {
  CreateComponentDto,
  CreateConnectionDto,
  CreateProjectDto,
  ProjectFilePathDto,
  SaveProjectFileDto,
  SaveProjectFilesDto,
  UpdateComponentDto,
  UpdateWaypointsDto,
} from './dto/project.dto';
import { ProjectComponentsService } from './project-components.service';
import { ProjectConnectionsService } from './project-connections.service';
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
    private readonly components: ProjectComponentsService,
    private readonly connections: ProjectConnectionsService,
    private readonly authorization: AuthorizationService,
    private readonly entitlements: EntitlementService,
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

  /**
   * Device and connection usage for one project, so the canvas can show a limit
   * before the user runs into it. The refusal is still what enforces it.
   */
  @Get(':projectId/usage')
  async projectUsage(
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

    const [components, connections] = await Promise.all([
      this.components.count(projectId),
      this.connections.count(projectId),
    ]);

    return this.entitlements.projectUsageReport(request.user.id, {
      components,
      connections,
    });
  }

  // ------------------------------------------------------------ components

  @Get(':projectId/components')
  async listComponents(
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
    return this.components.list(projectId);
  }

  @Post(':projectId/components')
  async addComponent(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateComponentDto,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
    return this.components.add(request.user.id, projectId, body);
  }

  /** Position, rotation, label, and property overrides. Used by drag and inspector. */
  @Patch(':projectId/components/:componentId')
  async updateComponent(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('componentId', ParseUUIDPipe) componentId: string,
    @Body() body: UpdateComponentDto,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
    return this.components.update(projectId, componentId, body);
  }

  @Delete(':projectId/components/:componentId')
  async removeComponent(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('componentId', ParseUUIDPipe) componentId: string,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
    await this.components.remove(projectId, componentId);
    return { deleted: true };
  }

  // ----------------------------------------------------------- connections

  @Get(':projectId/connections')
  async listConnections(
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
    return this.connections.list(projectId);
  }

  @Post(':projectId/connections')
  async addConnection(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: CreateConnectionDto,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
    return this.connections.add(request.user.id, projectId, body);
  }

  /** Manual bend points. An empty array resets the wire to automatic routing. */
  @Patch(':projectId/connections/:connectionId')
  async updateConnection(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Body() body: UpdateWaypointsDto,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
    return this.connections.setWaypoints(
      projectId,
      connectionId,
      body.waypoints,
    );
  }

  @Delete(':projectId/connections/:connectionId')
  async removeConnection(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
    await this.connections.remove(projectId, connectionId);
    return { deleted: true };
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
