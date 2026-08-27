# Security

## Security Model

Treat the following as separate concerns:

Authentication:
Who is the user?

Authorization:
What actions may the user perform?

Ownership:
Does the user own or belong to the resource?

Entitlement:
Does the user's subscription allow the action?

Sensitive operations must evaluate every applicable layer.

## Authentication

Prefer Supabase Auth.

Do not create another password database unless there is a documented requirement.

Support:

* registration
* email verification
* password reset
* session expiration
* session revocation
* MFA when enabled

## Authorization

Frontend checks are not security boundaries.

All protected operations must be authorized in NestJS.

Use:

* Guards
* Policies
* Workspace membership checks
* Resource ownership checks
* Entitlement checks

## Supabase RLS

Use Row Level Security on exposed sensitive tables.

Policies should consider:

* authenticated user
* workspace membership
* resource ownership
* role

RLS complements backend authorization.

It does not replace application-level business rules.

## Secrets

Never expose to Angular:

* Supabase service-role keys
* database passwords
* backend API secrets
* private keys
* device master secrets

Never log:

* passwords
* access tokens
* refresh tokens
* JWTs
* API keys
* device secrets

## XSS

Treat community and documentation content as untrusted input.

Sanitize user-generated Markdown or rich content.

Avoid unsafe HTML rendering.

Avoid bypassing Angular sanitization unless explicitly reviewed.

## Request Security

Apply:

* Helmet
* strict CORS
* DTO validation
* payload limits
* rate limiting
* request timeouts
* centralized error handling

Production responses must not expose:

* stack traces
* database errors
* filesystem paths
* secrets

## File Uploads

Validate:

* MIME type
* extension
* size
* ownership
* access policy

Do not trust client filenames.

Use generated object names.

Never concatenate user paths directly with server filesystem paths.

## User Code

User source code is hostile input.

Never run user code using:

* eval()
* new Function()
* shell execution inside NestJS API

Compilation must occur in isolated workers.

Build workers should be:

* ephemeral
* non-root
* CPU limited
* RAM limited
* timeout limited
* storage limited
* network restricted where possible

A build must not access:

* another user's files
* database credentials
* API secrets
* host filesystem

## AI Security

Before sending project context to an AI provider, redact:

* Wi-Fi passwords
* MQTT passwords
* tokens
* private keys
* API keys
* backend credentials

Limit context to files required for the current task.

## Device Credentials

Never store retrievable plaintext device secrets.

Prefer:

* one-time secret display
* hashed credentials
* scoped credentials
* rotation
* revocation

## Payment Security

Never trust payment status from frontend data.

Webhooks require:

* signature verification
* timestamp validation
* idempotency
* replay protection

---

# Current Implementation Status

Updated 2026-08-28 after Phase 0 (security containment). This section records what
is enforced in code today, what is deliberately switched off, and what still needs
a human. It is not aspirational — every claim below corresponds to shipped code.

## Enforced in code

| Control | Where |
| --- | --- |
| All workspace routes require a valid access token; no anonymous path exists | `workspace.controller.ts` (`JwtAuthGuard`) |
| Helmet security headers | `main.ts` |
| Origin allowlist, failing closed in production | `common/config/security.config.ts` |
| Request body limit | `main.ts` (`REQUEST_BODY_LIMIT`) |
| Global validation with `whitelist` and `forbidNonWhitelisted` | `main.ts` |
| Global rate limit, with stricter tiers on auth, AI, and build | `common/config/security.config.ts`, `@Throttle` on the routes |
| Request id on every request and every error response | `common/http/request-id.middleware.ts` |
| Production-safe error envelope; internals never reach the client | `common/filters/all-exceptions.filter.ts` |
| Refresh cookie is `Secure` unless explicitly opted out for local HTTP | `auth.controller.ts` |
| Seed credentials come from the environment or are generated | `prisma/seeds/user.seed.ts` |
| AI system context is an explicit allowlist with no host identity | `ai/system-context.service.ts` |
| Assistant markdown is sanitized before rendering | `markdown.pipe.ts` |

## Temporary capability limitations

**Firmware build, serial monitor, and host device listing are disabled.**

The previous implementation compiled user-supplied projects with `execFile` inside
the API process and passed the child the entire `process.env`, which contained the
database URL, both JWT secrets, and every AI provider key. A user-controlled
`platformio.ini` can execute arbitrary code through directives such as
`extra_scripts`, so the endpoint was remote code execution with full access to
platform secrets. The same services also exposed every serial port on the API host
to any authenticated user, with no ownership check.

Current behaviour:

| Endpoint | Behaviour |
| --- | --- |
| `GET  /api/projects/:projectId/workspace/toolchain` | Reports `available: false` |
| `POST /api/projects/:projectId/workspace/build` | `503 BUILD_TEMPORARILY_DISABLED` |
| `GET  /api/projects/:projectId/workspace/devices` | Empty list with an explanatory message |
| `POST /api/projects/:projectId/workspace/serial/start` | `503 SERIAL_TEMPORARILY_DISABLED` |
| `GET  /api/projects/:projectId/workspace/serial/output` | Idle stream, so a polling client stops cleanly |

File read, write, list, and delete are unaffected and remain available.

The capability returns in Phase 4 as a queued job run by an isolated, ephemeral,
non-root, resource-limited worker that never receives platform credentials.
Physical flashing moves to the browser (Web Serial) or a trusted local agent — a
server-side worker must not reach a user's hardware. A regression test in
`workspace-firmware.service.spec.ts` fails if any file in the workspace module
imports a process-spawning module or spreads `process.env` into a child.

## Manual actions required

These cannot be performed from the repository and are the operator's responsibility.

1. **Rotate `GEMINI_API_KEY` and `OPENROUTER_API_KEY`.** Real values are present in
   the untracked local `iot-hub-be/.env`. They were never committed, but they exist
   in plaintext on at least one workstation. Rotate at the provider, then update the
   local file.
2. **Rotate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`** if the same values were
   ever used outside local development. Rotating invalidates all existing sessions.
3. **Change any account seeded with the previously hardcoded password.** The literal
   was removed from `prisma/seeds/user.seed.ts` before that file's first commit, so
   it is not in Git history, but any database already seeded from the old file still
   holds it — including an `admin` account. A stale copy also existed in the
   untracked `iot-hub-be/dist/` build output, which was deleted.
4. **Set `CORS_ORIGINS` in every deployed environment.** Production serves no browser
   origin when it is unset.
5. **Set `NODE_ENV=production` in production.** Several controls read it.
6. **Do not set `ALLOW_INSECURE_COOKIES` outside local HTTP development.**
7. **Set `SEED_ADMIN_PASSWORD` / `SEED_USER_PASSWORD`** before seeding anything that
   is not a throwaway development database.

## Known gaps not closed by Phase 0

| Gap | Planned phase |
| --- | --- |
| Cloudflare Turnstile tokens are accepted but never verified; the CAPTCHA is decorative. Rate limiting is the only brute-force control today | Phase 3, or delete the widget |
| `POST /api/auth/forgot_password` is an empty handler returning 200 | Phase 3 (Supabase Auth) |
| No email verification and no MFA | Phase 3 |
| Role is read from the JWT claim, so a demotion takes up to 15 minutes to take effect | Phase 3 |
| No workspace membership or ownership model; file isolation is by user id in the path only | Phase 3 |
| Refresh-token reuse is not detected as a breach signal | Phase 3 |
| Expired and revoked sessions are never purged | Phase 3 |
| `GET /api/admin/users` is unpaginated | Phase 7 |
| No anti-CSRF token beyond `SameSite=Lax` | Phase 3 |
