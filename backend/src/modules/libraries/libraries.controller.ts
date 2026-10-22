import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
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
import {
  InstallLibraryDto,
  LibraryRefQueryDto,
  SearchLibrariesQueryDto,
} from './dto/library.dto';
import { LibrariesService } from './libraries.service';

/** The PlatformIO registry, browsed through the API. Any signed-in user. */
@Controller('libraries')
@UseGuards(SupabaseAuthGuard)
@Throttle(THROTTLE_OVERRIDES.libraryBrowse)
export class LibraryRegistryController {
  constructor(private readonly libraries: LibrariesService) {}

  @Get('search')
  search(@Query() query: SearchLibrariesQueryDto) {
    return this.libraries.search(query.q ?? '', query.page ?? 1, {
      platform: query.platform,
      sort: query.sort,
    });
  }

  @Get('package')
  details(@Query() query: LibraryRefQueryDto) {
    return this.libraries.details(query.owner, query.name);
  }
}

/**
 * Libraries installed in a project. Same two-step authorization as the projects
 * controller: the workspace role first, then that the project lives in it.
 */
@Controller('workspaces/:workspaceId/projects/:projectId/libraries')
@UseGuards(SupabaseAuthGuard)
export class ProjectLibrariesController {
  constructor(
    private readonly libraries: LibrariesService,
    private readonly projects: ProjectsService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    await this.authorize(request, workspaceId, projectId, 'viewer');
    return this.libraries.list(projectId);
  }

  @Post()
  @Throttle(THROTTLE_OVERRIDES.libraryInstall)
  async install(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: InstallLibraryDto,
  ) {
    await this.authorize(request, workspaceId, projectId, 'editor');
    return this.libraries.install(projectId, body);
  }

  @Delete(':folder')
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('folder') folder: string,
  ) {
    await this.authorize(request, workspaceId, projectId, 'editor');
    return this.libraries.remove(projectId, folder);
  }

  private async authorize(
    request: AuthenticatedRequest,
    workspaceId: string,
    projectId: string,
    required: WorkspaceRole,
  ) {
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      required,
    );
    await this.projects.requireInWorkspace(workspaceId, projectId);
  }
}
