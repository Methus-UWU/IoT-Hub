import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { ProjectsService } from '../projects/projects.service';
import type { WorkspaceRole } from '../workspaces/workspace-role';
import { DatastreamInput } from './dashboard.repository';
import { DashboardTemplatesService } from './dashboard-templates.service';
import { DashboardsService } from './dashboards.service';
import {
  ApplyTemplateDto,
  CreateTemplateDto,
  DatastreamDto,
  SaveDashboardDto,
  TemplateVersionDto,
  TemplateVersionQueryDto,
  UpdateTemplateDto,
} from './dto/dashboard.dto';

function toDatastreamInput(body: DatastreamDto): DatastreamInput {
  return {
    key: body.key,
    name: body.name,
    dataType: body.dataType,
    unit: body.unit ?? '',
    min: body.min ?? null,
    max: body.max ?? null,
    source: body.source ?? '',
    componentId: body.componentId ?? null,
  };
}

/**
 * Project dashboards and datastreams. Same two-step authorization as the projects
 * controller: the workspace role first, then that the project lives in it.
 */
@Controller('workspaces/:workspaceId/projects/:projectId')
@UseGuards(SupabaseAuthGuard)
export class DashboardsController {
  constructor(
    private readonly dashboards: DashboardsService,
    private readonly templates: DashboardTemplatesService,
    private readonly projects: ProjectsService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get('dashboard')
  async get(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.authorize(request, workspaceId, projectId, 'viewer');
    return this.dashboards.get(projectId);
  }

  @Put('dashboard')
  async save(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: SaveDashboardDto,
  ) {
    await this.authorize(request, workspaceId, projectId, 'editor');
    return this.dashboards.save(projectId, body.document, body.expectedVersion);
  }

  @Post('dashboard/apply-template')
  async applyTemplate(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: ApplyTemplateDto,
  ) {
    const { role, project } = await this.authorize(
      request,
      workspaceId,
      projectId,
      'editor',
    );
    return this.templates.apply(
      workspaceId,
      request.user.id,
      role,
      body.templateId,
      project,
      {
        version: body.version,
        expectedVersion: body.expectedVersion ?? null,
      },
    );
  }

  @Get('datastreams')
  async listDatastreams(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.authorize(request, workspaceId, projectId, 'viewer');
    return this.dashboards.listDatastreams(projectId);
  }

  @Post('datastreams')
  async createDatastream(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: DatastreamDto,
  ) {
    await this.authorize(request, workspaceId, projectId, 'editor');
    return this.dashboards.createDatastream(projectId, toDatastreamInput(body));
  }

  @Put('datastreams/:datastreamId')
  async updateDatastream(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('datastreamId', ParseUUIDPipe) datastreamId: string,
    @Body() body: DatastreamDto,
  ) {
    await this.authorize(request, workspaceId, projectId, 'editor');
    return this.dashboards.updateDatastream(
      projectId,
      datastreamId,
      toDatastreamInput(body),
    );
  }

  @Delete('datastreams/:datastreamId')
  @HttpCode(204)
  async deleteDatastream(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('datastreamId', ParseUUIDPipe) datastreamId: string,
  ): Promise<void> {
    await this.authorize(request, workspaceId, projectId, 'editor');
    await this.dashboards.deleteDatastream(projectId, datastreamId);
  }

  private async authorize(
    request: AuthenticatedRequest,
    workspaceId: string,
    projectId: string,
    required: WorkspaceRole,
  ) {
    const role = await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      required,
    );
    const project = await this.projects.requireInWorkspace(
      workspaceId,
      projectId,
    );
    return { role, project };
  }
}

/** Workspace-scoped dashboard templates. */
@Controller('workspaces/:workspaceId/dashboard-templates')
@UseGuards(SupabaseAuthGuard)
export class DashboardTemplatesController {
  constructor(
    private readonly templates: DashboardTemplatesService,
    private readonly projects: ProjectsService,
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
    return this.templates.list(workspaceId, request.user.id);
  }

  @Get(':templateId')
  async get(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Query() query: TemplateVersionQueryDto,
  ) {
    const role = await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'viewer',
    );
    return this.templates.get(
      workspaceId,
      request.user.id,
      role,
      templateId,
      query.version,
    );
  }

  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: CreateTemplateDto,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    const project = await this.projects.requireInWorkspace(
      workspaceId,
      body.projectId,
    );
    return this.templates.createFromProject(
      workspaceId,
      request.user.id,
      project,
      body,
    );
  }

  @Post(':templateId/versions')
  async addVersion(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() body: TemplateVersionDto,
  ) {
    const role = await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    const project = await this.projects.requireInWorkspace(
      workspaceId,
      body.projectId,
    );
    return this.templates.addVersionFromProject(
      workspaceId,
      request.user.id,
      role,
      templateId,
      project,
    );
  }

  @Patch(':templateId')
  async update(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() body: UpdateTemplateDto,
  ) {
    const role = await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    return this.templates.updateMetadata(
      workspaceId,
      request.user.id,
      role,
      templateId,
      body,
    );
  }

  @Post(':templateId/duplicate')
  async duplicate(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
  ) {
    const role = await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    return this.templates.duplicate(
      workspaceId,
      request.user.id,
      role,
      templateId,
    );
  }

  @Delete(':templateId')
  @HttpCode(204)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
  ): Promise<void> {
    const role = await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'editor',
    );
    await this.templates.delete(workspaceId, request.user.id, role, templateId);
  }
}
