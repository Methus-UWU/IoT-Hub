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

Data API privileges are deny-first. Migration
`20260926000000_harden_data_api_privileges` revokes the default table grants from
`anon` and `authenticated`, grants back read access where an explicit policy permits it,
and keeps all application writes behind NestJS authorization and DTO validation. It also
revokes public schema creation, and removes public RPC access from internal functions.
Only the workspace/project access helpers remain executable by authenticated users.

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

## Firmware builds (Phase 4, 2026-10-02)

The legacy implementation compiled user-supplied projects with `execFile` inside the
API process and passed the child the entire `process.env` — database URL, both JWT
secrets, every AI key. A user-controlled `platformio.ini` runs arbitrary Python
through `extra_scripts`, so the endpoint was remote code execution with full access
to platform secrets, and it exposed every serial port on the API host to any user.
That code is deleted. Builds now follow `docs/adr/ADR-002-build-isolation.md`:

```
Angular → API (queue row) → build-dispatcher → builder container → API (result)
                                                        Web Serial ← browser ← artifact
```

| Control | Where |
| --- | --- |
| The API never starts a process or evaluates code; a source-level test fails if any API file imports `child_process`/`worker_threads`/`cluster`, spreads `process.env`, or calls `eval`/`new Function` | `src/common/security/no-process-spawn.spec.ts` |
| One builder container per build: `--network=none`, `--read-only`, `--user=1000:1000`, `--cap-drop=ALL`, `no-new-privileges`, memory = swap limit, CPU, pid, open-file, and tmpfs size limits, killed after `BUILD_TIMEOUT_MS` | `build-worker/dispatcher/src/builder-container.ts` |
| The container receives only the source files on stdin. No host mount, no environment from the dispatcher, no credential of any kind | same |
| A project's `platformio.ini` never reaches PlatformIO. The builder writes its own from an allowlist of preinstalled platforms and boards; everything (toolchains, frameworks, catalog libraries) is baked into the image, because the build has no network | `build-worker/builder/build.py`, `targets.json` |
| Source paths are re-validated in the container with the project-file segment rules; only `src/`, `include/`, `lib/` are accepted | `build.py` |
| The dispatcher holds the Docker socket (root-equivalent on the host) and therefore nothing else: no database URL, no Supabase key, no AI key. Its one credential is `BUILD_WORKER_TOKEN`, which can only claim a job and report its result | `compose.yaml` (`build-dispatcher`), `build-worker.guard.ts` |
| Worker routes return 404 when no token is configured, compare tokens over SHA-256 digests in constant time, and are not routed by nginx (`/api/internal/` → 404) | `build-worker.guard.ts`, `deploy/nginx.conf` |
| A worker result is untrusted data: shaped by user code, so it is size-bounded, the image set must match the platform exactly, and flash offsets come from the API, never from the worker | `build-worker.service.ts`, `build-plan.ts` |
| Builds and artifacts are workspace-scoped: `editor` to build or cancel, `viewer` to read or download, plus the project-in-workspace check | `builds.controller.ts` |
| Build minutes are enforced per plan before a build is queued; one active build per project | `entitlement.service.ts`, `prisma-build-job.repository.ts` |
| The server never touches the user's hardware. Flashing and the serial monitor use Web Serial in the browser, which asks the user to pick the port | `frontend/.../workspace/firmware/` |

Verified against the real image on 2026-10-02: a library `extraScript` running in
the build could not open a socket, could not write to `/opt` or `/`, and ran as
uid 1000.

### Library Manager

Registry libraries are installed as project files (ADR-006), so the builder keeps
`--network=none`. The API does the download, and it treats both the registry and the
archive as untrusted.

| Control | Where |
| --- | --- |
| Outbound requests go only to `https://api.registry.platformio.org` and archive URLs on `*.platformio.org` over HTTPS. Redirects are followed by hand and re-checked; no credentials, no other ports (SSRF) | `src/modules/libraries/library-registry.ts` |
| Archives are capped at 4 MB while streaming, must match the registry's SHA-256, and inflate to at most 24 MB | same, `library-archive.ts` |
| The tar reader is in memory and touches no filesystem. It reads regular files only and ignores links and devices. Paths must pass the project-file segment rules, and `..` is refused | `library-archive.ts`, `project-file-path.ts` |
| Only sources, headers, the manifest, and the license are kept. Files containing a NUL byte are dropped. A library adds at most 300 files and 4 MB, and the project quota is checked in the write transaction | `library-archive.ts`, `prisma-project.repository.ts` |
| `build.extraScript` and `scripts` are stripped from `library.json` | `sanitizeLibraryJson` |
| Only folders with the manager's marker are replaced or removed; a user's own `lib/` code is never overwritten | `libraries.service.ts` |
| `viewer` lists installed libraries; `editor` installs and removes them. Registry routes need a signed-in user and are throttled | `libraries.controller.ts`, `security.config.ts` |

Residual risk: the boundary is the host kernel (Option A of ADR-002). A container
escape from the builder lands on the Docker host, which also runs the API. Move the
builder to a separate host or a microVM executor before offering builds to
unauthenticated users.

## Manual actions required

These cannot be performed from the repository and are the operator's responsibility.

1. **Rotate `GEMINI_API_KEY` and `OPENROUTER_API_KEY`.** Real values are present in
   the untracked local `backend/.env`. They were never committed, but they exist
   in plaintext on at least one workstation. Rotate at the provider, then update the
   local file.
2. **Rotate `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`** if the same values were
   ever used outside local development. Rotating invalidates all existing sessions.
3. **Change any account seeded with the previously hardcoded password.** The literal
   was removed from `prisma/seeds/user.seed.ts` before that file's first commit, so
   it is not in Git history, but any database already seeded from the old file still
   holds it — including an `admin` account. A stale copy also existed in the
   untracked `backend/dist/` build output, which was deleted.
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

---

# Supabase Auth Cutover (Phases 2–3)

Updated 2026-08-28. Decisions and rationale: `docs/adr/ADR-003-supabase-auth-migration.md`.

## What changed

The platform no longer stores passwords, issues tokens, or tracks sessions. The
`sessions` table and `users.password` are dropped by migration
`20260828000000_supabase_auth_and_workspaces`, and `public.users` becomes a profile
row keyed by `auth.users.id`.

| Control | Where it now lives |
| --- | --- |
| Registration, login, logout, refresh | Supabase Auth, called from Angular |
| Email verification, password reset, MFA | Supabase Auth |
| Google and GitHub sign-in | Supabase Auth (PKCE) |
| Token verification | `SupabaseAuthGuard`, against the project JWKS |
| Platform admin check | `AuthorizationService.requirePlatformAdmin`, from the database |
| Workspace permission | `AuthorizationService.requireWorkspaceRole`, from the database |
| Account suspension | Supabase ban **and** the `is_active` profile flag |
| RLS | Enabled on `users`, `workspaces`, `workspace_members`, `roles` |

Only a verdict about the token ends a session. `SupabaseAuthGuard` answers 401 for
an expired, forged, or foreign token, but 503 when the JWKS cannot be fetched. On
the client, the interceptor signs the user out only when Supabase rejects the
refresh token, never on a network fault. The role guards log out only on a 401
from `/auth/me`; other failures are retried. Before this, a restarting API or a
dropped connection logged the user out while their Supabase session was still
valid.

Findings closed by this cutover: A1, A2, A4, A5, A6, A7, A9, S11, S12, S13, and A3
(Turnstile removed rather than left as a decorative control).

## Secret handling

| Key | Holder | Rule |
| --- | --- | --- |
| `SUPABASE_PUBLISHABLE_KEY` (anon) | Angular bundle and API | Browser-safe. Grants nothing on its own; RLS decides what its bearer may read |
| `SUPABASE_SECRET_KEY` (service_role) | API only, inside `SupabaseAdminService` | **Bypasses RLS.** Never in Angular, never logged, never in a build worker's environment |

`SupabaseAdminService` is the only holder of the secret key in the API. Privileged
operations go through named methods on it rather than through clients constructed at
call sites, so there is one file to audit.

## Setup required before this runs

1. **Supabase Dashboard → Project Settings → API**: copy the publishable key into
   `src/environments/environment*.ts` (`supabasePublishableKey`) together with
   `supabaseUrl`, and the secret key into the backend `SUPABASE_SECRET_KEY`.
2. **Dashboard → Connect → ORMs**: point `DATABASE_URL` at the Supabase session
   pooler, then run `npx prisma migrate deploy`.
3. **Dashboard → Authentication → Providers**: enable Google and GitHub, and set each
   provider's callback to `https://<project-ref>.supabase.co/auth/v1/callback`.
4. **Dashboard → Authentication → URL Configuration**: add `<app-origin>/auth/callback`
   to the redirect allowlist.
5. **Dashboard → Authentication → Attack Protection**: enable CAPTCHA. This replaces
   the removed Turnstile widget, whose token was never verified by anything.
6. **Grant the first administrator** after signing up:
   `UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'admin') WHERE email = '<address>';`

Until steps 1 and 2 are done the API starts and logs which keys are missing, and
every authenticated route answers `503 AUTH_NOT_CONFIGURED` — it fails closed rather
than open.

## Superseded manual actions

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are no longer read by any code and can
be deleted from the environment; the platform issues no tokens. The earlier
instruction to change the password on `admin1` and `user1` is also moot under the
start-clean decision, **provided the legacy local database is never exposed** — it
still contains those accounts with the leaked password. Drop that database, or
change the passwords in it, once nothing depends on it.
