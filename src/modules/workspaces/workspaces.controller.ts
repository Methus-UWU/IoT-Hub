import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../auth/supabase-auth.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { WorkspaceRepository } from './workspace.repository';

/**
 * Workspace discovery.
 *
 * The listing is scoped by membership in the query itself rather than filtered
 * afterwards, so a workspace the caller does not belong to is never loaded, let
 * alone returned.
 */
@Controller('workspaces')
@UseGuards(SupabaseAuthGuard)
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Every workspace the caller belongs to, with the role they hold in each. */
  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.workspaces.listForUser(request.user.id);
  }

  @Get(':workspaceId/members')
  async listMembers(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    // Members are visible to fellow members; a non-member gets 404, not 403.
    await this.authorization.requireWorkspaceRole(
      request.user.id,
      workspaceId,
      'viewer',
    );
    return this.workspaces.listMembers(workspaceId);
  }
}
