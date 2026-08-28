import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UserRepository } from '../users/user.repository';
import { WorkspaceRepository } from '../workspaces/workspace.repository';
import { satisfies, WorkspaceRole } from '../workspaces/workspace-role';

/**
 * The one place permission is evaluated.
 *
 * Controllers and services ask this service a question; they never compare role
 * strings themselves. Two consequences that matter:
 *
 * 1. Every answer is resolved from the database, not from a token claim, so
 *    revoking access takes effect on the next request rather than at the next token
 *    refresh.
 * 2. "Not a member" and "does not exist" produce the same 404, so an outsider
 *    cannot use error codes to discover which workspace ids are real.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly users: UserRepository,
  ) {}

  /**
   * Asserts the user holds at least `required` in the workspace and returns the
   * role they actually hold.
   */
  async requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    required: WorkspaceRole,
  ): Promise<WorkspaceRole> {
    const membership = await this.workspaces.findMembership(
      workspaceId,
      userId,
    );

    // Deliberately 404, not 403: revealing that a workspace exists is itself
    // information an outsider should not get.
    if (!membership) {
      throw new NotFoundException({
        code: 'WORKSPACE_NOT_FOUND',
        message: 'Workspace not found',
      });
    }

    if (!satisfies(membership.role, required)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_WORKSPACE_ROLE',
        message: `This action requires the ${required} role or higher`,
      });
    }

    return membership.role;
  }

  /** Non-throwing form, for shaping a response rather than guarding an action. */
  async hasWorkspaceRole(
    userId: string,
    workspaceId: string,
    required: WorkspaceRole,
  ): Promise<boolean> {
    const membership = await this.workspaces.findMembership(
      workspaceId,
      userId,
    );
    return membership !== null && satisfies(membership.role, required);
  }

  /**
   * Platform administrator check for the admin console.
   *
   * Read from the database on every call. The previous implementation trusted a
   * `role` claim in the access token, so a demoted administrator kept full
   * privileges until that token expired.
   */
  async requirePlatformAdmin(userId: string): Promise<void> {
    const user = await this.users.findProfileById(userId);

    if (!user || !user.isActive || user.role.name.toLowerCase() !== 'admin') {
      throw new ForbiddenException({
        code: 'ADMIN_ROLE_REQUIRED',
        message: 'Admin role is required',
      });
    }
  }

  /** Asserts the account is active; a suspended user keeps a valid token. */
  async requireActiveAccount(userId: string): Promise<void> {
    const user = await this.users.findProfileById(userId);

    if (!user || !user.isActive) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account is not active',
      });
    }
  }
}
