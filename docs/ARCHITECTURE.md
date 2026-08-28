# Architecture

This document describes the **target** architecture. Sections 1 to 10 are the target. The sections from "Current State" onward record where the code actually is today and how it gets to the target.

The evidence behind the current-state summary is in `docs/LEGACY_AUDIT.md`.

## Product Goal

Build an all-in-one IoT ecosystem combining:

* Knowledge Base
* Community
* IoT Library Registry
* AI Assistant
* Web IDE
* Device Management
* Telemetry
* Dashboard Builder
* Build and Deployment
* Billing

Target workflow:

Learn
→ Ask AI
→ Create Project
→ Write Code
→ Build
→ Flash
→ Connect Device
→ Receive Telemetry
→ Create Dashboard
→ Deploy
→ Share

## System Architecture

Primary architecture:

Browser
→ Angular
→ NestJS API
→ Supabase PostgreSQL

Supporting systems:

NestJS
→ Supabase Auth

NestJS
→ Supabase Storage

NestJS
→ Build Queue
→ Isolated Build Worker

Devices
→ IoT Gateway
→ Telemetry Layer
→ PostgreSQL

IoT Gateway
→ WebSocket Gateway
→ Angular Dashboard

AI features:

Angular
→ NestJS AI Module
→ Context Builder
→ Secret Redaction
→ AI Provider

## Architectural Style

Use a modular monolith for the application backend.

Separate processes only when required for:

* security isolation
* heavy workloads
* independent scaling
* failure isolation

The build system is intentionally separated because it processes untrusted code.

## Core Domain Model

User
→ Workspace
→ Project
→ Device
→ Datastream
→ Dashboard Widget

Additional domains:

Knowledge
Community
Library
AI
Billing

## Backend Modules

Recommended NestJS modules:

auth/
users/
workspaces/
projects/
knowledge/
community/
libraries/
ai/
build/
devices/
iot/
telemetry/
dashboards/
billing/
admin/

## Frontend Features

Recommended Angular features:

auth/
knowledge/
community/
libraries/
ai/
projects/
ide/
devices/
dashboards/
billing/
settings/
admin/

## Build Architecture

Never compile user code inside the API process.

Use:

API
→ Build Job
→ Queue
→ Isolated Worker
→ Compiler
→ Artifact Storage
→ Build Result

Build workers must be resource-limited and isolated.

## Realtime Architecture

Use WebSocket for interactive realtime functionality.

Avoid high-frequency polling.

Telemetry events should update only affected dashboard widgets.

## Future Scalability

Do not prematurely split into microservices.

Potential future independently scalable components:

* build workers
* AI workers
* telemetry ingestion
* WebSocket gateway

Only extract them when actual operational requirements justify it.

---

# Current State

Audited 2026-08-28. Details and file references: `docs/LEGACY_AUDIT.md`.

## What Exists

Browser
→ Angular 22 (196 files, ~45,600 lines)
→ NestJS 11 API (`/api`, no version segment)
→ Prisma 7
→ PostgreSQL (primary + optional read replica)

Alongside that, and outside any database:

NestJS API process
→ `execFile('pio', …)`
→ PlatformIO toolchain on the API host
→ `.workspace-data/<userId>/<projectId>/` on the API filesystem

## Implemented Backend Modules

| Module | State |
| --- | --- |
| `auth` | Custom JWT, bcrypt passwords, `sessions` table with rotation and revocation |
| `admin-users` | List, list roles, update — admin only, unpaginated |
| `ai` | 7 provider adapters, admin only, keys held server-side |
| `workspace` | File CRUD, PlatformIO build, device listing, serial monitor — **runs untrusted code in-process** |

The other ten domains named above (`users`, `workspaces`, `projects`, `knowledge`, `community`, `libraries`, `build`, `devices`, `telemetry`, `dashboards`, `billing`) do not exist.

## Gap Against the Target

| Target element | Current state |
| --- | --- |
| Supabase PostgreSQL | Plain PostgreSQL via Prisma. Supabase appears nowhere in the source |
| Supabase Auth | Custom JWT + local password table |
| Supabase Storage | Server filesystem, no database record |
| Isolated build worker | `execFile` inside the API process, with the full `process.env` passed to the child |
| Build queue | None — builds run synchronously in the request, up to 180 s |
| WebSocket gateway | None — the serial monitor polls over HTTP every 650 ms |
| Telemetry layer | None |
| IoT gateway / devices | None. "Devices" means serial ports attached to the API host |
| Workspace membership and RLS | None. A single `role_id` column, `admin` or `user` |
| Domain model beyond auth | Three tables: `roles`, `users`, `sessions` |
| Versioned API, error envelope, rate limiting, `helmet` | None |

## Blocking Risks

Three findings must be closed before any public deployment, migrated or not:

1. User-supplied `platformio.ini` can execute arbitrary code inside the API process (`LEGACY_AUDIT.md` S1).
2. That process receives `DATABASE_URL`, both JWT secrets, and every AI API key through `process.env` (S2).
3. `WorkspaceAccessGuard` fabricates an authenticated user whenever `NODE_ENV` is not `production` — the permissive path is the default (S3).

---

# Migration Path

Incremental strangler migration. The legacy system keeps serving traffic; each phase moves one capability and deletes the code it replaces. No phase leaves the system in a non-working state.

## Phase 0 — Containment and Groundwork

No architectural change. Removes the blocking risks and makes the repository migratable.

1. Rotate the AI API keys that are currently in `iot-hub-be/.env`; change the seeded `Nong4548!` password.
2. Set `WORKSPACE_ALLOW_ANONYMOUS=false` and `NODE_ENV` explicitly in every environment. Remove the anonymous branch from `WorkspaceAccessGuard` entirely rather than relying on configuration.
3. Disable or restrict `POST /workspace/build` until Phase 4 delivers an isolated worker.
4. Sanitise the `markdown` pipe output.
5. Add `helmet`, a payload limit, `@nestjs/throttler` on auth and AI routes, and a global exception filter with the `{ error: { code, message, requestId } }` envelope from `docs/API.md`.
6. Resolve the nested Git repositories (decision Q4) and add CI running lint, type-check, and tests.

**Exit criteria:** no critical finding from the audit remains open; one repository; CI green.

## Phase 1 — Foundations

1. Create the Supabase project (decision Q7: cloud or self-hosted).
2. Record decision Q1 in `docs/adr/ADR-001-database-access.md` before writing any data access code.
3. Introduce the repository layer in the existing NestJS code, still backed by the current database. Every service stops calling `prisma.db.*` directly.
4. Move the API to `/api/v1` and apply the response envelope across existing endpoints.
5. Add a `BrowserStorageService` and a base signal-store helper on the frontend, removing the duplication recorded as P8 and P9.

**Why the repository layer comes first:** it is the seam that makes Phase 2 a change of implementation rather than a rewrite of every service.

**Exit criteria:** no ORM type crosses a service boundary; all endpoints versioned and enveloped; behaviour unchanged.

## Phase 2 — Database Move

1. Port the schema to Supabase PostgreSQL as versioned migrations, keeping one source of truth (per `docs/DATABASE.md`).
2. Expand the schema to the target domain model: `workspaces`, `workspace_members`, `projects`, `project_files`, `devices`, `datastreams`, `dashboards`, `dashboard_widgets`.
3. Point the repository layer at Supabase. Only repository implementations change.
4. Enable RLS on exposed tables, with a security test per important policy.

**Exit criteria:** the application runs against Supabase PostgreSQL; RLS policies have tests; the old database is read-only.

## Phase 3 — Authentication Move

1. Adopt Supabase Auth. Replace `JwtStrategy` with a Supabase token guard; replace `AdminRoleGuard` with a policy layer that reads role and workspace membership **from the database**, not from a token claim (closes S11).
2. Migrate or discard existing accounts (decision Q2).
3. Delete `users.password`, the `sessions` table, `AuthService` token handling, and the Turnstile stub.
4. Keep the frontend `authInterceptor` refresh behaviour; only its token source changes.
5. Enable email verification, password reset, and MFA — capabilities the current system does not have at all.

**Exit criteria:** no password hash and no refresh token is stored by application code; role changes take effect immediately.

## Phase 4 — Build Isolation

This phase is the reason the build system is a separate process in the target architecture.

1. `POST /projects/:id/builds` enqueues a job and returns immediately.
2. An ephemeral, non-root, resource-limited worker pulls the job, receives **only** the project files and a scoped artifact upload token — never `DATABASE_URL`, never a JWT secret, never an AI key.
3. Artifacts land in Supabase Storage; build status is pushed over WebSocket as `build.status.changed`.
4. Delete the in-process `execFile` path.

Isolation mechanism is decision Q3.

**Exit criteria:** no user-controlled input reaches a process that holds platform secrets.

## Phase 5 — Storage and Project Files

1. Move `.workspace-data/` into `project_files` rows plus Supabase Storage objects.
2. Reuse the existing path-safety layer from `workspace.service.ts` verbatim for object keys — it is the strongest security code in the repository.
3. Enforce per-project file count, file size, and total size quotas at the database level.

**Exit criteria:** no application state lives on the API filesystem; the API is stateless and horizontally scalable.

## Phase 6 — Realtime

1. Add the WebSocket gateway with the versioned event contracts from `docs/API.md`.
2. Replace the 650 ms serial polling loop with `device.serial.output` events.
3. Replace the simulated server-monitoring interval with real data or delete the page.

Decision Q6 determines whether Supabase Realtime covers part of this.

**Exit criteria:** no interactive feature polls.

## Phase 7 — Domain Build-Out

Deliver the remaining domains in dependency order, deleting the corresponding fixtures from `mock-api.interceptor.ts` and the `localStorage` stores as each lands:

`workspaces` → `projects` → `devices` → `telemetry` → `dashboards` → `knowledge` → `community` → `libraries` → `billing`

**Exit criteria:** `mock-api.interceptor.ts` is deleted; no feature persists domain state in `localStorage`.

## Sequencing Constraints

- Phase 0 does not depend on anything and should start immediately.
- Phase 1 must precede Phase 2; the repository layer is what makes the database swap cheap.
- Phase 3 depends on Phase 2, because membership and policy tables must exist before authorization can read them.
- Phase 4 depends on nothing but Phase 0 and can run in parallel with Phases 1 to 3. It is the highest-risk item and should not be scheduled last.
- Phases 5, 6, and 7 depend on Phase 2.

## What Does Not Change

The virtual device simulator, the dashboard builder canvas, the Monaco editor integration, the Angular routing and lazy-loading structure, the AI provider adapter pattern, and the workspace path-safety layer are carried forward unchanged. They are the parts of the legacy system worth keeping.

## Undecided

Do not treat these as settled. Alternatives and trade-offs are recorded in `docs/LEGACY_AUDIT.md` section 16: database access layer (Q1), user migration (Q2), build isolation mechanism (Q3), repository layout (Q4), telemetry storage (Q5), realtime split (Q6), hosting model (Q7).

---

# Migration Status

Updated 2026-08-28.

| Phase | Status |
| --- | --- |
| 0 — Security containment | **Complete** |
| 1 — Data access foundation | **Complete** |
| 2 — Supabase foundation | **Complete** — Supabase Cloud; config boundary, schema, and RLS in place |
| 3 — Authentication and authorization | **Complete** — Supabase Auth with email, Google, GitHub; database-resolved authorization |
| 4 — Build isolation | **Blocked** — isolation mechanism undecided (ADR-002) |
| 5 — Project files and Storage | Not started; depends on Phase 2 |
| 6 — Realtime | Not started; depends on Phase 2 |
| 7 — Domain migration | Not started; depends on Phase 2 |

## Phase 0 — delivered

Three critical findings closed. The anonymous authentication bypass is deleted, not
merely configured off. In-process compilation of user-controlled projects is deleted,
along with every path that handed a child process the platform environment. Baseline
request security — Helmet, an origin allowlist that fails closed, payload limits,
rate limiting with stricter tiers on auth, AI, and build, request ids, and a global
exception filter that never leaks internals — is in place. Details and the remaining
manual actions are in `docs/SECURITY.md`.

## Phase 1 — delivered

`Controller → Service → Repository contract → Prisma implementation`. No business
service imports `PrismaService`; the only three files that do are the repository
implementations. The database decision is recorded in
`docs/adr/ADR-001-database-access.md` and is now cheap to reverse, because changing
it means writing new implementations of three abstract classes and editing two
`useClass` bindings.

## What blocks the rest

The remaining phases are blocked on decisions with cost or irreversibility, not on
implementation effort:

1. **Supabase hosting model** — cloud or self-hosted (ADR-003 D1). No project exists;
   the current database is plain PostgreSQL with only a `public` schema.
2. **Existing account migration** — the live database holds three accounts that are
   *not* clean seed data, including an administrator (ADR-003 D2).
3. **Build isolation mechanism** — container, microVM, or managed runner, each with
   different operational cost (ADR-002).

Until these are answered, the safe state is the current one: builds disabled, the
legacy auth path working and hardened, and Prisma isolated behind repositories.

## Deferred from Phase 1, deliberately

Two items listed in the Phase 1 plan above were not done, and are not silently
dropped:

1. **`/api` → `/api/v1`.** The versioned prefix required by `docs/API.md` also
   requires changing `environment.apiUrl` in the frontend. The frontend working tree
   currently holds a large amount of uncommitted work, so changing its configuration
   mid-stream risks disrupting it for no security benefit. Do this together with the
   first Supabase-backed endpoint, when the frontend is being touched anyway.
2. **Frontend `BrowserStorageService` and the shared signal-store helper.** These
   remove duplication (`LEGACY_AUDIT.md` P8, P9) but change no behaviour and touch
   many files in that same uncommitted working tree. Better done as its own change
   once that work is committed.

The error envelope from `docs/API.md` **is** implemented, in the global exception
filter. The success envelope (`{ data, meta }`) is not yet applied, because changing
response shapes without versioning would break the frontend immediately; it belongs
with item 1.

## Phase 2 — delivered

Supabase Cloud is the platform. `SupabaseConfig` is the single configuration
boundary and distinguishes the browser-safe publishable key from the RLS-bypassing
secret key, which only `SupabaseAdminService` holds. Migration
`20260828000000_supabase_auth_and_workspaces` adds the workspace ownership model,
RLS policies, and the sign-up trigger as raw SQL inside a Prisma migration, keeping
one migration history as ADR-001 requires.

## Phase 3 — delivered

Authentication is Supabase Auth (email/password, Google, GitHub). The platform holds
no password, issues no token, and tracks no session.

Authorization stayed in NestJS and became centralized. `AuthorizationService` is the
only place a role is compared, and every answer is read from the database rather
than from a token claim, so a demotion or suspension takes effect on the next
request. `SupabaseAuthGuard` establishes identity and deliberately grants nothing —
a forged `role` claim is ignored, and a test asserts it.

Ownership is now explicit: `workspaces` and `workspace_members`, with roles
`owner | admin | developer | editor | viewer`. A non-member and a non-existent
workspace produce the same 404, so ids cannot be enumerated.

## Remaining phases

| Phase | Status |
| --- | --- |
| 4 — Build isolation | **Blocked** on the infrastructure choice in ADR-002 |
| 5 — Project files and Storage | **Backend complete**; Angular IDE not yet switched over |
| 6 — Realtime | Ready to start |
| 7 — Domain migration | Ready to start, beginning with projects |

Workspace files still live on the API filesystem, keyed by user id. That is the last
piece of the old ownership model and is what Phase 5 replaces with `project_files`
rows plus Supabase Storage objects, at which point the workspace routes switch from
"scoped by user id" to a `requireWorkspaceRole` check.

## Phase 5 — backend delivered

Project files are database rows, not paths on the API host. Migration
`20260828020000_projects_and_project_files` adds `projects` and `project_files` with
RLS, quota `CHECK` constraints, and a unique `(project_id, path)` index.

Content lives in a `TEXT` column rather than Supabase Storage — see
`docs/adr/ADR-004-project-file-storage.md`. These are small source files written by
an autosaving editor, and keeping them in Postgres makes a save one atomic,
versioned statement instead of a two-phase write that can leave a row pointing at a
missing object. Storage remains the right home for build artifacts, which arrive
with Phase 4.

The path-safety layer was carried over **unchanged** into `project-file-path.ts` and
is now enforced twice: in the service, and again as a database `CHECK` constraint.
Both were verified against the live database.

Verified end to end over HTTP against Supabase:

| Property | Result |
| --- | --- |
| Cross-workspace read | 404 `WORKSPACE_NOT_FOUND` |
| Project reached through a workspace it does not belong to | 404 `PROJECT_NOT_FOUND` |
| Unauthenticated request | 401 |
| Path traversal | 400 `INVALID_FILE_PATH` |
| Stale write | 409 `FILE_VERSION_CONFLICT` |
| Batch autosave | saved per file, conflicts reported separately |

### What remains for Phase 5

The Angular IDE still calls the deprecated `/api/projects/:projectId/workspace/*`
endpoints, which read the API filesystem and scope by user id.

Switching it over is entangled with the projects domain (Phase 7, first item): route
ids are currently localStorage slugs such as `smart-greenhouse`, and they have to
become real project UUIDs served by the API before the new endpoints can be called
at all. `ProjectsApiService` is in place on the client and ready for that work.

The old filesystem endpoints stay until then, per the rule that legacy is removed
only after its replacement is working — not before.
