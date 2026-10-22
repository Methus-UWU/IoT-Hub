/**
 * Workspace roles, ordered. Permission checks compare rank, so adding a role means
 * adding it here once rather than editing every call site.
 *
 * This mirrors the CHECK constraint and `workspace_role_rank()` in the database
 * migration; the two must be changed together.
 */
export const WORKSPACE_ROLES = [
  'viewer',
  'editor',
  'developer',
  'admin',
  'owner',
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const RANK: Record<WorkspaceRole, number> = {
  viewer: 10,
  editor: 20,
  developer: 30,
  admin: 40,
  owner: 50,
};

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function rankOf(role: WorkspaceRole): number {
  return RANK[role];
}

/** True when `held` is at least as privileged as `required`. */
export function satisfies(
  held: WorkspaceRole,
  required: WorkspaceRole,
): boolean {
  return RANK[held] >= RANK[required];
}
