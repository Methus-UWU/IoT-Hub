import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
  SaveWorkspaceFileDto,
  WorkspaceFilePathDto,
} from './dto/workspace.dto';
import { WorkspaceService } from './workspace.service';

/**
 * Every route requires a verified Supabase token and an active account, so a
 * suspended user loses access on the next request rather than when their token
 * expires.
 *
 * Files are still isolated by the authenticated user id, which is the ownership
 * boundary until projects become database rows in Phase 7. At that point the check
 * becomes a workspace membership check through AuthorizationService.
 */
@Controller('projects/:projectId/workspace')
@UseGuards(SupabaseAuthGuard)
export class WorkspaceController {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get('files')
  async listFiles(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
  ) {
    await this.authorization.requireActiveAccount(request.user.id);
    return this.workspace.listFiles(request.user.id, projectId);
  }

  @Get('file')
  async readFile(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Query() query: WorkspaceFilePathDto,
  ) {
    await this.authorization.requireActiveAccount(request.user.id);
    return this.workspace.readFile(request.user.id, projectId, query.path);
  }

  @Put('file')
  async saveFile(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: SaveWorkspaceFileDto,
  ) {
    await this.authorization.requireActiveAccount(request.user.id);
    return this.workspace.saveFile(
      request.user.id,
      projectId,
      body.path,
      body.content,
    );
  }

  @Delete('file')
  async deleteFile(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Query() query: WorkspaceFilePathDto,
  ) {
    await this.authorization.requireActiveAccount(request.user.id);
    return this.workspace.deleteFile(request.user.id, projectId, query.path);
  }
}
