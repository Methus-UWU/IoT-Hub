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
  /** Public write endpoints: anyone with an account can reach them. */
  communityWrite: { default: { ttl: MINUTE_MS, limit: 20 } },
  /** Library search proxies the PlatformIO registry; cached, but still third-party. */
  libraryBrowse: { default: { ttl: MINUTE_MS, limit: 60 } },
  /** A library install downloads and unpacks archives: up to six per request. */
  libraryInstall: { default: { ttl: 5 * MINUTE_MS, limit: 10 } },
  /** Boards report and poll; several may share one public IP behind a router. Each device is also limited to one report per second by TelemetryService. */
  deviceApi: { default: { ttl: MINUTE_MS, limit: 600 } },
} as const;

export const REQUEST_BODY_LIMIT = '1mb';

/**
 * A build result from the dispatcher: up to four ESP32 images as base64 plus a
 * log. Applies only to the worker-token route under /api/internal/build-jobs.
 */
export const BUILD_RESULT_BODY_LIMIT = '24mb';

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

/**
 * Express `trust proxy` value from `TRUST_PROXY`, or undefined to trust none.
 *
 * Unset by default: trusting `X-Forwarded-For` without a proxy in front lets any
 * client choose the address it is recorded and throttled under. Behind the
 * bundled nginx, set it to the proxy networks (for example
 * `loopback, uniquelocal`) or to a hop count.
 */
export function trustProxySetting(): string | number | undefined {
  const value = process.env.TRUST_PROXY?.trim();
  if (!value) return undefined;
  return /^\d+$/.test(value) ? Number(value) : value;
}
