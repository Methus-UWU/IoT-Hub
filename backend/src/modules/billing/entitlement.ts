/**
 * Plan limits, named once.
 *
 * These keys match the `plan_limits.key` column. Adding a limit means adding a key
 * here and a row per plan — never an `if (plan === 'pro')` at a call site, which is
 * how limit logic ends up scattered and inconsistent.
 */
export const LIMIT_KEYS = {
  maxProjects: 'max_projects',
  maxComponentsPerProject: 'max_components_per_project',
  maxConnectionsPerProject: 'max_connections_per_project',
  maxStorageMb: 'max_storage_mb',
  maxBuildMinutes: 'max_build_minutes',
  maxAiRequests: 'max_ai_requests',
} as const;

export type LimitKey = (typeof LIMIT_KEYS)[keyof typeof LIMIT_KEYS];

/** A plan value of -1 means the limit does not apply. */
export const UNLIMITED = -1;

export interface PlanSummary {
  code: string;
  name: string;
  limits: Readonly<Record<string, number>>;
}

export function isUnlimited(value: number): boolean {
  return value === UNLIMITED;
}

/**
 * Percentage used, for display only. Unlimited reports 0 rather than a
 * meaningless fraction, and the caller renders the limit as "Unlimited".
 */
export function usagePercent(used: number, limit: number): number {
  if (isUnlimited(limit) || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}
