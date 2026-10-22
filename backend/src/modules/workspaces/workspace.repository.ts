import { WorkspaceRole } from './workspace-role';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
}

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

export interface WorkspaceSummary extends Workspace {
  /** The requesting user's own role in this workspace. */
  role: WorkspaceRole;
}

/**
 * Persistence contract for workspaces and their membership.
 * See docs/adr/ADR-001-database-access.md.
 */
export abstract class WorkspaceRepository {
  /**
   * The single query the authorization layer depends on. Returns null when the
   * user is not a member, which is indistinguishable from the workspace not
   * existing — callers must not leak the difference.
   */
  abstract findMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembership | null>;

  abstract listForUser(userId: string): Promise<WorkspaceSummary[]>;

  abstract findById(workspaceId: string): Promise<Workspace | null>;

  abstract listMembers(
    workspaceId: string,
  ): Promise<
    { userId: string; username: string; email: string; role: WorkspaceRole }[]
  >;

  abstract addMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<void>;

  abstract updateMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<void>;

  abstract removeMember(workspaceId: string, userId: string): Promise<void>;

  /** Number of members holding `owner`, so the last owner cannot be removed. */
  abstract countOwners(workspaceId: string): Promise<number>;
}
