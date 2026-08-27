/**
 * Single source of truth for request-security settings.
 *
 * Every value fails closed in production: an unset origin allowlist rejects all
 * cross-origin traffic rather than falling back to a permissive default.
 */

const MINUTE_MS = 60_000;

export interface ThrottleRule {
  readonly name: string;
  readonly ttl: number;
  readonly limit: number;
}

/** The single tier registered globally and enforced by ThrottlerGuard. */
export const THROTTLE_RULES = {
  default: { name: 'default', ttl: MINUTE_MS, limit: 120 },
} as const satisfies Record<string, ThrottleRule>;

/**
 * Per-handler tightenings of the global tier, applied with `@Throttle(...)`.
 * Expensive or abusable endpoints must pick one of these instead of inventing
 * their own numbers at the call site.
 */
export const THROTTLE_OVERRIDES = {
  /** Credential endpoints: brute force and enumeration. */
  auth: { default: { ttl: MINUTE_MS, limit: 10 } },
  /** Third-party AI calls cost money per request. */
  ai: { default: { ttl: 5 * MINUTE_MS, limit: 20 } },
  /** Firmware builds are minutes of CPU per request. */
  build: { default: { ttl: 5 * MINUTE_MS, limit: 5 } },
} as const;

export const REQUEST_BODY_LIMIT = '1mb';

export const REQUEST_ID_HEADER = 'x-request-id';

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Explicit origin allowlist. CORS_ORIGINS is comma-separated and wins; FRONTEND_URL
 * remains supported for the existing single-origin deployments. Outside production a
 * localhost default keeps `ng serve` working without configuration.
 */
export function corsOrigins(): string[] {
  const configured = (
    process.env.CORS_ORIGINS ??
    process.env.FRONTEND_URL ??
    ''
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured;
  if (isProduction()) return [];
  return ['http://localhost:4200'];
}
