# API

## Base Route

Production liveness: `GET /api/health` returns
`{ "data": { "status": "ok" } }` without authentication or rate limiting.
It reports process liveness only and exposes no configuration or database details.
See `DEPLOYMENT.md` for container health and startup behavior.

Use versioned APIs.

Example:

`/api/v1`

## Controllers

Controllers should:

- receive validated requests
- call services
- map results to HTTP responses

Controllers should not contain:

- SQL
- complex business logic
- direct payment verification logic
- large authorization workflows

## DTOs

Validate all external input.

Use DTOs for:

- request body
- route parameters
- query parameters

Do not trust Angular validation as a security boundary.

## Success Response

Recommended structure:

{
"data": {},
"meta": {}
}

Use `meta` for:

- pagination
- cursors
- totals
- additional response metadata

## Error Response

Recommended structure:

{
"error": {
"code": "PROJECT_NOT_FOUND",
"message": "Project not found",
"requestId": "..."
}
}

Use stable machine-readable error codes.

## Domain Errors

Prefer domain errors such as:

- ProjectNotFoundError
- ProjectAccessDeniedError
- DeviceOfflineError
- BuildTimeoutError
- QuotaExceededError

Map domain errors centrally to HTTP responses.

Do not repeat try/catch logic in every controller.

## Authorization

Every protected endpoint must authorize on the backend.

Depending on the resource, check:

- user identity
- workspace membership
- role
- ownership
- entitlement

## Pagination

Do not return unlimited collections.

Support pagination.

Use cursor pagination when collections can become large.

## Realtime

Use WebSocket for interactive realtime flows such as:

- telemetry updates
- dashboard state
- build status
- device online/offline events

Use REST for resource CRUD unless realtime semantics provide a clear benefit.

## WebSocket Events

Use clear versioned event contracts.

Example:

`telemetry.updated`

`device.status.changed`

`build.status.changed`

Do not send arbitrary undocumented payload shapes.

## Idempotency

Use idempotency for operations where retries may create duplicates.

Examples:

- payment webhooks
- subscription updates
- some provisioning operations

## Rate Limiting

Apply stricter limits to:

- authentication
- AI
- build requests
- device provisioning
- expensive searches
- public write endpoints

---

# Implemented Endpoints (2026-08-28)

Base prefix is `/api`. The `/api/v1` move is still outstanding — see
`docs/ARCHITECTURE.md`. Runnable request/response examples are in "Usage Examples"
at the end of this file.

## Admin database (2026-09-06)

`GET /api/admin/database/overview` requires `SupabaseAuthGuard` followed by
`PlatformAdminGuard` (current database profile role, including active-account check).
There are no request parameters or body. Responses use `Cache-Control: no-store`.

Returns `{ version, sizeBytes, databaseConnections, maxConnections, checkedAt }`.
`checkedAt` is an ISO timestamp from PostgreSQL. The repository reads the primary
in a read-only transaction with a five-second statement timeout. Size includes all
schemas and indexes of the current database. Connections include idle sessions for
that database; `maxConnections` is the server-wide setting, not a per-database quota.
No host, database name, connection string, SQL text, or row data is returned.

Statistics failures return `503 DATABASE_OVERVIEW_UNAVAILABLE`, without driver
details. An unavailable authorization lookup fails closed before metrics are read.
The previous frontend-only `/api/admin/backups` calls (list/create/delete/restore)
are retired. This page performs no backup or restore operations.

## Admin operations (2026-09-29)

Both endpoints require `SupabaseAuthGuard` followed by `PlatformAdminGuard` and send
`Cache-Control: no-store`.

`GET /api/admin/monitoring/snapshot` returns one measured snapshot containing:

- counts of users, active/suspended users, projects, project files, and community
  posts from PostgreSQL;
- CPU and RSS memory for the NestJS process, process uptime/load/PID, and filesystem
  usage when the operating system exposes it;
- a bounded PostgreSQL connectivity check with latency and active connections;
- request totals, 5xx count, and average duration for the last five minutes; and
- the latest request-log entries held by this process.

Request logs never store headers, query strings, bodies, tokens, or client IPs. The
buffer is capped at 200 entries and resets on process restart, so it is operational
telemetry rather than a durable audit record. A failed database read produces
`platform: null` and an explicit disconnected state; the API does not invent fallback
counts.

`GET /api/admin/integrations` returns a fixed allowlist of services the application
actually uses: PostgreSQL, Supabase Auth/Storage, and OpenRouter. PostgreSQL is tested
on each request. Supabase and OpenRouter report whether their required server-side
configuration exists; their keys and URLs are never returned. The endpoint is
read-only because dynamic credentials are not a supported runtime configuration
source.

## Admin users (2026-09-29)

`GET /api/admin/users` requires `SupabaseAuthGuard` followed by
`PlatformAdminGuard`. Profile fields come from PostgreSQL, while `lastLoginAt`
comes from Supabase Auth's server-only user administration API. The response also
includes `lastLoginAvailable`: when it is `true`, a null `lastLoginAt` means the
account has never signed in; when it is `false`, the identity provider could not
be checked and clients must not describe the account as never signed in.

`lastLoginIp` (2026-10-06) is the address Supabase Auth recorded on the session
that sign-in created, read from `auth.sessions` because the Admin API does not
expose it. It is null when that session no longer exists (signed out or expired),
when the newest session did not start at `lastLoginAt`, or when the read fails;
a failed read never hides `lastLoginAt`. The address is personal data and is
returned only to platform administrators.

`PATCH /api/admin/users/:id` returns the same activity fields so an edited row does
not lose its last-login state. It accepts `username`, `role`, and `status` only;
email and password belong to the account owner and Supabase Auth. Supabase secret
credentials remain confined to the backend and are never returned to the client.

| Method | Path | Notes |
| ------ | ---- | ----- |
| POST | `/api/admin/users` | `{ email, username, password, role? }`. Creates a confirmed Supabase account; the sign-up trigger builds the profile and workspace. `409 USERNAME_TAKEN` / `EMAIL_TAKEN` are checked before the identity is created. |
| DELETE | `/api/admin/users/:id` | 204. Deletes the Supabase identity; profile, workspaces, projects, community content, and history follow by cascade. `400 CANNOT_DELETE_SELF`. |

The admin user-history action and `GET /api/admin/users/:id/login-events` were
retired. Last sign-in columns remain available in the user list; the account
owner's `/api/auth/login-events` history is unchanged.

## Authentication

Registration, login, logout, refresh, password reset, and OAuth are performed by
the Angular client directly against Supabase Auth. The API issues no tokens.

| Method | Path                     | Auth           | Notes                                    |
| ------ | ------------------------ | -------------- | ---------------------------------------- |
| GET    | `/api/auth/me`           | Supabase token | Application profile                      |
| PATCH  | `/api/auth/me`           | Supabase token + active profile | Username and optional display name/bio; email belongs to Supabase |
| GET    | `/api/auth/me/avatar`    | Supabase token + active profile | Private PNG response, `Cache-Control: private, no-store`; 404 if absent |
| PUT    | `/api/auth/me/avatar`    | Supabase token + active profile | Multipart `file`: PNG magic bytes, up to 512 KiB and 512 × 512 pixels; returns 204 |
| DELETE | `/api/auth/me/avatar`    | Supabase token + active profile | Remove the current account's image; returns 204 |
| GET    | `/api/auth/availability` | public         | Throttled; enumeration oracle            |
| POST   | `/api/auth/login-events` | Supabase token | Records the current session as a sign-in; 204, idempotent per session |
| GET    | `/api/auth/login-events` | Supabase token | Own sign-in history, newest 50: `{ id, ipAddress, userAgent, createdAt }` |

`PATCH /api/auth/me` accepts `{ username, displayName?, bio? }`. Username keeps its
2–40 character identifier rules; display name supports Unicode up to 60 characters,
and bio supports plain text up to 280 characters. Optional fields are trimmed;
blank strings or `null` clear them, while omission preserves their saved values.
GET/PATCH return both optional values as nullable strings. The authenticated subject
is the only write target; role, email, and owner overrides are rejected.

Supabase signs users in inside the browser, so the client reports each session
once. The row is keyed by the verified token's `session_id`; the address and device
come from the request (`req.ip`, `User-Agent`), never from the body. Behind a proxy,
`req.ip` is correct only when `TRUST_PROXY` is set (see `DEPLOYMENT.md`).

## Search history (2026-09-29)

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/api/me/search-history?scope=documents\|community` | Newest 10 queries for the scope |
| POST | `/api/me/search-history` | `{ scope, query }`, 1–100 characters after whitespace is collapsed; 204. A repeat moves to the top; older entries beyond 10 are deleted. |
| DELETE | `/api/me/search-history?scope=…` | Clears that scope; 204 |

## IoT advisor (2026-09-29)

`POST /api/ai/advisor/chat` — any signed-in user, AI throttle tier. Body
`{ mode?: 'advice' | 'error', messages: [{ role, content }] }` (1–30 messages, each
up to 12,000 characters); returns the same shape as the admin chat. `advice`
covers device choice, wiring, and example code for Arduino IDE and PlatformIO;
`error` adds instructions for analysing Arduino IDE / PlatformIO compiler, upload,
and serial errors and uses the deep model profile. There is no model override and
no system context: the advisor has no tools and reads no user data. Nothing is
stored.

Since 2026-10-01 the advisor answers through Gemini when `GEMINI_API_KEY` is set
(`vendor: "google"` in the response) and falls back to the OpenRouter model policy
on any Gemini failure, so the response shape and error codes are unchanged. A 429
whose `error.code` is `AI_RATE_LIMITED` is the provider's quota, not the platform
throttle.

## Workspaces

| Method | Path                                   | Required role                    |
| ------ | -------------------------------------- | -------------------------------- |
| GET    | `/api/workspaces`                      | membership (scoped in the query) |
| GET    | `/api/workspaces/:workspaceId/members` | `viewer`                         |

## Projects and files

All scoped by workspace. Each handler checks the caller's workspace role **and**
that the project belongs to that workspace; without the second check a member of
any workspace could reach any project by id.

Project responses expose `updatedAt` as the latest persisted activity anywhere in
the project. Saving or deleting a source file, component, or connection updates the
parent timestamp; it is not an alias for `createdAt`.

| Method | Path                                            | Required role             |
| ------ | ----------------------------------------------- | ------------------------- |
| GET    | `/api/workspaces/:wid/projects`                 | `viewer`                  |
| POST   | `/api/workspaces/:wid/projects`                 | `editor`                  |
| DELETE | `/api/workspaces/:wid/projects/:pid`            | `admin`                   |
| GET    | `/api/workspaces/:wid/projects/:pid/files`      | `viewer`                  |
| GET    | `/api/workspaces/:wid/projects/:pid/file?path=` | `viewer`                  |
| PUT    | `/api/workspaces/:wid/projects/:pid/file`       | `editor`                  |
| PUT    | `/api/workspaces/:wid/projects/:pid/files`      | `editor` — batch autosave |
| DELETE | `/api/workspaces/:wid/projects/:pid/file?path=` | `editor`                  |

### Creating a project

`POST /api/workspaces/:wid/projects` accepts `{ name, description?, boardId,
framework?, deviceIds? }`. Names are trimmed and must contain 1–80 characters;
descriptions allow up to 500. Choose a board from authenticated `GET /api/boards`.
Only catalog boards with implemented canvas definitions are offered:
`esp32-devkit-v1`, `esp32-devkit-38`, and `arduino-uno-r3`. Existing projects using
legacy board metadata remain readable. Each board lists its `frameworks` (default
first, also returned as `defaultFramework`); `framework` must be one of them and
defaults to the first.

`deviceIds` contains up to 49 canonical peripheral catalog IDs; omit it or send
`[]` for a board-only project. Repeating an ID creates that quantity of the same
peripheral. Additional boards and unknown devices are rejected. The backend checks
project quota and the component quota including the initial board, then commits the
project, board, selected peripherals, and starter files in one nested repository
write. The response includes the persisted `components` array. `PlatformIO`
projects get `platformio.ini` and `src/main.cpp`, `Arduino C++` projects get
`main.ino`; list them with `GET .../files` (see `docs/pages/user-projects.md` § "Starter files").
No wiring, firmware generation, or AI plan application occurs during creation.

Creation refusals include `BOARD_NOT_FOUND`, `INVALID_PROJECT_SETUP`,
`INVALID_INITIAL_DEVICE`, `PROJECT_LIMIT_REACHED`, and `COMPONENT_LIMIT_REACHED`,
in addition to DTO validation and workspace authorization errors.

### Optimistic concurrency

`PUT .../file` takes `{ path, content, expectedVersion? }`.

- **With** `expectedVersion`: updates only if the stored version still matches.
  A mismatch returns `409 FILE_VERSION_CONFLICT` carrying `currentVersion` and
  `currentHash` so the client can reconcile.
- **Without** `expectedVersion`: creates only. A client that has lost track of the
  version cannot blind-write over a revision it never saw; an existing path returns
  `409 FILE_ALREADY_EXISTS`.

### Batch autosave

`PUT .../files` takes `{ files: [...] }`, up to 50 per request, and returns
`{ saved, conflicts }`. Outcomes are per file on purpose: one stale editor tab must
not discard the user's work in every other tab.

### Error codes

`INVALID_FILE_PATH`, `FILE_TOO_LARGE`, `FILE_NOT_FOUND`, `FILE_ALREADY_EXISTS`,
`FILE_VERSION_CONFLICT`, `PROJECT_NOT_FOUND`, `PROJECT_SLUG_TAKEN`,
`PROJECT_FILE_LIMIT_REACHED`, `PROJECT_SIZE_LIMIT_REACHED`, `WORKSPACE_NOT_FOUND`,
`INSUFFICIENT_WORKSPACE_ROLE`, `ADMIN_ROLE_REQUIRED`, `ACCOUNT_SUSPENDED`,
`AUTH_NOT_CONFIGURED`.

A workspace or project the caller cannot see returns **404, not 403** — a 403 would
confirm the id exists.

## Firmware builds (2026-10-02)

Compilation runs in an isolated builder container, never in the API — see
`docs/adr/ADR-002-build-isolation.md` and `docs/SECURITY.md` § "Firmware builds".
Same double check as the project routes (workspace role, then project-in-workspace).

| Method | Path                                                              | Required role |
| ------ | ----------------------------------------------------------------- | ------------- |
| POST   | `/api/workspaces/:wid/projects/:pid/builds`                       | `editor`      |
| GET    | `/api/workspaces/:wid/projects/:pid/builds`                       | `viewer`      |
| GET    | `/api/workspaces/:wid/projects/:pid/builds/:bid`                  | `viewer`      |
| POST   | `/api/workspaces/:wid/projects/:pid/builds/:bid/cancel`           | `editor`      |
| GET    | `/api/workspaces/:wid/projects/:pid/builds/:bid/artifacts/:name`  | `viewer`      |

- `POST .../builds` takes no body. It snapshots the stored files (not the editor's
  unsaved state) and returns **202** `{ build, reused }`. When the same sources for
  the same board already built and the image is still kept, that build is returned
  with `reused: true` and no build minutes are spent. Throttled with the `build` tier.
- A build is `queued` → `running` → `succeeded` | `failed` | `canceled`. The client
  polls `GET .../builds/:bid` (about every 1.5 s) until it leaves `queued`/`running`;
  the `build.status.changed` WebSocket event replaces polling in Phase 6.
- A build response carries `status`, `boardId`, `failureReason`
  (`compile` | `rejected` | `timeout` | `worker_error` | `artifacts`), timings,
  `artifacts: [{ name, flashOffset, sizeBytes, sha256 }]`, and
  `flash: { protocol: 'esptool' | 'stk500v1' | 'stk500v2', baudRate } | null`.
  `GET .../builds/:bid` adds `log` (the last 64 KiB of compiler output); the list
  returns the newest 10 without logs.
- Artifacts download as `application/octet-stream`. Names are `bootloader.bin`,
  `partitions.bin`, `boot_app0.bin`, `firmware.bin` (ESP32, flashed at the given
  offsets) or `firmware.hex` (AVR). Only the newest successful build of a project
  keeps its images.
- Which files are compiled: a PlatformIO project's `src/`, `include/`, and `lib/`;
  an Arduino C++ project's root sketch sources (`.ino`, `.cpp`, `.h`, …), moved under
  `src/`. A project's `platformio.ini` is never used; the builder generates its own.
- Buildable boards are those with `flash` in `GET /api/boards`.

### Error codes

`BUILD_WORKER_NOT_CONFIGURED` (503), `BUILD_NOT_SUPPORTED` (422, board or framework),
`BUILD_NO_SOURCES` (422), `BUILD_MINUTES_EXHAUSTED` (409, with `limit`, `used`),
`BUILD_ALREADY_ACTIVE` (409, with the active `buildId`), `BUILD_NOT_ACTIVE` (409,
cancel of a finished build), `BUILD_NOT_FOUND`, `BUILD_ARTIFACT_NOT_FOUND`.

### Worker routes

For the build dispatcher only; `Authorization: Bearer <BUILD_WORKER_TOKEN>`. 404 when
no token is configured, and nginx does not route `/api/internal/`.

| Method | Path                                         | Notes |
| ------ | -------------------------------------------- | ----- |
| POST   | `/api/internal/build-jobs/claim`             | 200 `{ id, platform, platformBoard, files }` for the oldest queued build, or 204 |
| POST   | `/api/internal/build-jobs/:bid/result`       | `{ status, failureReason?, log, durationMs, artifacts?: [{ name, data(base64) }] }` → 204; 409 `BUILD_NOT_RUNNING` when it was canceled or timed out meanwhile. Body limit 24 MB on this route only |

## Deprecated

`/api/projects/:projectId/workspace/file(s)` still serves files from the API
filesystem and is scoped by user id rather than by workspace membership. The Angular
IDE no longer calls it; it is removed in a follow-up. Its former `toolchain`,
`build`, `devices`, and `serial/*` routes were deleted with Phase 4.

---

# Project Canvas Endpoints (2026-08-28)

## Plan and usage

| Method | Path                                       | Notes                                                       |
| ------ | ------------------------------------------ | ----------------------------------------------------------- |
| GET    | `/api/me/usage`                            | Account usage: projects, storage, build minutes, AI credits |
| GET    | `/api/workspaces/:wid/projects/:pid/usage` | Devices and connections against the per-project ceilings    |
| GET    | `/api/boards`                              | Boards a project can be created with                        |

Usage endpoints are **display only**. A limit is enforced by the refusal on the
write it guards, never by the client having read a number first.

## Components

| Method | Path                                                 | Required role |
| ------ | ---------------------------------------------------- | ------------- |
| GET    | `/api/workspaces/:wid/projects/:pid/components`      | `viewer`      |
| POST   | `/api/workspaces/:wid/projects/:pid/components`      | `editor`      |
| PATCH  | `/api/workspaces/:wid/projects/:pid/components/:cid` | `editor`      |
| DELETE | `/api/workspaces/:wid/projects/:pid/components/:cid` | `editor`      |

`POST` accepts `{ definitionId, label?, x?, y?, rotation?, state? }`. Omitting the
position lets the server choose a free grid cell instead of stacking every new
component at the same coordinates.

`definitionId` names a catalog entry in the frontend — the definition describes
what an ESP32 is, the row describes where one sits in a project. It is not a
foreign key, because the catalog is code rather than a table.

## Dashboards and datastreams (2026-10-10)

| Method | Path | Required role |
| ------ | ---- | ------------- |
| GET    | `/api/workspaces/:wid/projects/:pid/dashboard` | `viewer` |
| PUT    | `/api/workspaces/:wid/projects/:pid/dashboard` | `editor` |
| POST   | `/api/workspaces/:wid/projects/:pid/dashboard/apply-template` | `editor` |
| GET    | `/api/workspaces/:wid/projects/:pid/datastreams` | `viewer` |
| POST   | `/api/workspaces/:wid/projects/:pid/datastreams` | `editor` |
| PUT    | `/api/workspaces/:wid/projects/:pid/datastreams/:did` | `editor` |
| DELETE | `/api/workspaces/:wid/projects/:pid/datastreams/:did` | `editor` |
| GET    | `/api/workspaces/:wid/dashboard-templates` | `viewer` |
| GET    | `/api/workspaces/:wid/dashboard-templates/:tid?version=` | `viewer` |
| POST   | `/api/workspaces/:wid/dashboard-templates` | `editor` |
| POST   | `/api/workspaces/:wid/dashboard-templates/:tid/versions` | creator or `admin` |
| PATCH  | `/api/workspaces/:wid/dashboard-templates/:tid` | creator or `admin` |
| POST   | `/api/workspaces/:wid/dashboard-templates/:tid/duplicate` | `editor` |
| DELETE | `/api/workspaces/:wid/dashboard-templates/:tid` | creator or `admin` |

`PUT .../dashboard` takes `{ document, expectedVersion? }` with the same create/update
rule as files. A widget may bind only to a datastream the project has and a component
the project contains. Applying a template copies its document and adds its missing
datastreams in one transaction; widget component ids are cleared because they belong
to another project. A board mismatch is returned in `warnings`, not refused. Someone
else's private template is a 404.

The project assistant stages dashboard changes with `define_datastream`,
`place_widget`, `update_widget`, `remove_widget`, and `arrange_dashboard`; the plan
carries one `set_dashboard` action with the dashboard version it was built on, and
apply refuses it as `AI_PLAN_STALE` if the dashboard changed since.

### Error codes

`INVALID_DASHBOARD`, `DASHBOARD_UNKNOWN_DATASTREAM`, `DASHBOARD_UNKNOWN_DEVICE`,
`DASHBOARD_ALREADY_EXISTS`, `DASHBOARD_VERSION_CONFLICT`, `DASHBOARD_EMPTY`,
`DATASTREAM_KEY_TAKEN`, `DATASTREAM_IN_USE`, `DATASTREAM_NOT_FOUND`,
`DATASTREAM_UNKNOWN_COMPONENT`, `DATASTREAM_LIMIT_REACHED`, `TEMPLATE_NOT_FOUND`,
`TEMPLATE_VERSION_NOT_FOUND`, `TEMPLATE_EDIT_FORBIDDEN`.

## Libraries (2026-10-11)

Library Manager, ADR-006. Registry routes need a signed-in user; project routes use the
usual workspace role and project-in-workspace checks.

| Method | Path | Required role |
| ------ | ---- | ------------- |
| GET    | `/api/libraries/search?q=&page=&sort=&platform=` | signed in |
| GET    | `/api/libraries/package?owner=&name=` | signed in |
| GET    | `/api/workspaces/:wid/projects/:pid/libraries` | `viewer` |
| POST   | `/api/workspaces/:wid/projects/:pid/libraries` | `editor` |
| DELETE | `/api/workspaces/:wid/projects/:pid/libraries/:folder` | `editor` |

`search` proxies the PlatformIO registry for Arduino libraries. `sort` is
`popularity` (default), `trending`, `updated`, or `relevance`. `platform` is
`espressif32` or `atmelavr`. Results are 20 per page, and registry answers are cached
for 10 minutes. `POST .../libraries` takes `{ owner, name, version? }` and installs
the latest version when `version` is omitted. It writes the library into
`lib/<Folder>/` together with the dependencies its manifest names, up to six libraries
in one transaction, and returns `{ installed, skipped }`. A dependency that cannot be
resolved goes into `skipped` with a reason and does not fail the install. Installing a
library that is already installed replaces its folder. `DELETE` removes only folders
the manager installed. Throttles: 60 per minute for the registry routes, 10 installs
per 5 minutes.

### Error codes

`LIBRARY_NOT_FOUND` (404), `LIBRARY_REGISTRY_UNAVAILABLE` (502), `LIBRARY_INVALID`,
`LIBRARY_UNSUPPORTED`, `LIBRARY_NOT_ARDUINO` (422), `LIBRARY_FOLDER_TAKEN` (409),
`LIBRARY_NOT_INSTALLED` (404), `INVALID_LIBRARY_FOLDER` (400), plus the project quota
codes `PROJECT_FILE_LIMIT_REACHED` and `PROJECT_SIZE_LIMIT_REACHED` (409).

## AI profiles and conversations (2026-10-11)

ADR-007. Profiles belong to a user or, when system profiles, to the platform. Conversations
are private to their author and tied to one project.

| Method | Path | Required role |
| ------ | ---- | ------------- |
| GET    | `/api/ai/profiles` | signed in (system + own) |
| POST   | `/api/ai/profiles` | signed in; `scope: "system"` needs platform admin |
| PATCH  | `/api/ai/profiles/:id` | owner, or platform admin for a system profile |
| DELETE | `/api/ai/profiles/:id` | owner, or platform admin for a system profile |
| GET    | `/api/workspaces/:wid/projects/:pid/ai/conversations` | `viewer`, own only |
| POST   | `/api/workspaces/:wid/projects/:pid/ai/conversations` | `viewer` |
| GET    | `/api/workspaces/:wid/projects/:pid/ai/conversations/:cid` | `viewer`, author |
| PATCH  | `/api/workspaces/:wid/projects/:pid/ai/conversations/:cid` | `viewer`, author |
| DELETE | `/api/workspaces/:wid/projects/:pid/ai/conversations/:cid` | `viewer`, author |
| PATCH  | `/api/workspaces/:wid/projects/:pid/ai/conversations/:cid/messages/:mid` | `viewer`, author |
| POST   | `/api/workspaces/:wid/projects/:pid/ai/conversations/import` | `viewer` |

A profile is `{ name, description, model | null, tier: "auto" | "balanced" | "deep",
instructions, scope }`. Each user may keep up to 20 personal profiles. A conversation is
created with `{ profileId? }`, and `PATCH` changes `title` or `profileId` (`null` = default)
without touching its messages. Up to 50 conversations are kept per user per project; creating
one more deletes the least recently used. The `messages/:mid` route records
`{ planState: "applied" | "failed" | "dismissed", planError? }` for an assistant turn that
proposed a plan.

`POST .../ai/chat` and `.../ai/chat/stream` accept `conversationId` and `profileId`. With
`conversationId`, the server reads the stored history, uses only the last request message as
the question, stores the question and the answer, and returns `conversationId`, `messageId`,
`userMessageId`, and `profileId` with the usual result. Without `conversationId`, the turn
works as before.

### Error codes

`AI_PROFILE_NOT_FOUND` (404), `AI_PROFILE_FORBIDDEN`, `ADMIN_ROLE_REQUIRED` (403),
`AI_PROFILE_LIMIT_REACHED` (409), `AI_CONVERSATION_NOT_FOUND`, `AI_MESSAGE_NOT_FOUND` (404),
`AI_MESSAGE_REQUIRED` (400).

`POST .../ai/conversations/import { title, messages: [{ role, content }] }` (1–200 messages, each up to
12,000 characters) moves a conversation the browser kept before 2026-10-11 into the project.
Only text is imported, never a plan.

## AI models and credits (2026-10-11)

ADR-009. The `admin/` routes require a platform admin, read from the database.

`POST /api/admin/ai/chat` uses the same model selection policy as the IDE: saved
primary/fallback models take priority over `AI_PROJECT_MODEL`, then the shared
catalog ranking supplies candidates. Both paths try at most three candidates.
Legacy `model` and `profile` fields are accepted but ignored by admin chat;
the admin UI no longer offers X1/X2/X3 tiers. Saved conversation history cannot
override the current platform policy. Responses still identify the served model.

| Method | Path | Required role |
| ------ | ---- | ------------- |
| GET    | `/api/admin/ai-settings` | platform admin |
| PUT    | `/api/admin/ai-settings` | platform admin |
| GET    | `/api/admin/ai-settings/overrides` | platform admin |
| PUT    | `/api/admin/ai-settings/overrides/:userId` | platform admin |
| DELETE | `/api/admin/ai-settings/overrides/:userId` | platform admin |
| GET    | `/api/admin/ai-settings/usage` | platform admin |
| GET    | `/api/admin/ai-settings/usage/:userId` | platform admin |
| GET    | `/api/ai/credits` | signed in (own usage) |

`GET` returns `{ primaryModel, fallbackModels, defaults: { daily, weekly, monthly }, updatedAt,
catalog: { stale, fetchedAt, models } }`. `PUT` accepts any of `primaryModel` (`null` hands
the choice back to the environment and the ranked catalog), `fallbackModels` (up to 5, in
order), and `defaults`. Each limit is an integer from -1 to 1,000,000, and -1 means unlimited.
An override is `{ daily, weekly, monthly, note }`, where `null` keeps the default. Usage per
user is `{ daily, weekly, monthly }`, each `{ used, limit, resetsAt }`, counted in Thailand
time.

An answered request costs `max(1, ceil((input_tokens + 4 × output_tokens) / 2000))` credits,
with tokens summed over every round of the turn. An AI request is refused with
`429 AI_CREDIT_LIMIT_REACHED` once any period's credits are spent. The body includes `period`, `limit`, and `resetsAt`.

The admin catalog also returns `latencyOrder`, an optional list of model IDs ordered
by OpenRouter's `GET /models?sort=latency-low-to-high`. It is cached for five minutes;
an upstream failure returns an empty list and is retried after one minute, without
failing settings or changing runtime model selection. This is provider ordering,
not measured milliseconds for this installation. Reversing it also reverses any
unmeasured models OpenRouter places at the end. See the
[OpenRouter models API](https://openrouter.ai/docs/api/api-reference/models/get-models).

AI settings also return `resets`. `PUT /api/admin/ai-settings` accepts the full
schedule as `{ resets: { dailyMinute, weeklyMinute, weeklyDay, monthlyMinute,
monthlyDay } }`. Minutes are integers 0–1439 after midnight in `Asia/Bangkok`;
`weeklyDay` is 0 (Monday) through 6 (Sunday), and `monthlyDay` is 1–28.
Defaults are `{ dailyMinute: 0, weeklyMinute: 0, weeklyDay: 0, monthlyMinute: 0,
monthlyDay: 1 }`. Partial or null schedules are rejected. The existing admin guard
applies, and omitted schedules are preserved. Changes recalculate current windows
from recorded usage; the settings cache can take 15 seconds to refresh on another
API process. Usage totals use these same windows. If several periods are exhausted,
the 429 response reports the latest reset, when all exhausted periods have cleared.

### Error codes

`AI_MODEL_NOT_FOUND`, `AI_PRIMARY_MODEL_REQUIRED` (400), `USER_NOT_FOUND`,
`AI_CREDIT_OVERRIDE_NOT_FOUND` (404), `AI_CREDIT_LIMIT_REACHED` (429),
`ADMIN_ROLE_REQUIRED` (403).

## Devices and telemetry (2026-10-11)

ADR-008. Project routes use the usual workspace role and project-in-workspace checks.

| Method | Path | Required role |
| ------ | ---- | ------------- |
| GET    | `/api/workspaces/:wid/projects/:pid/devices` | `viewer` |
| POST   | `/api/workspaces/:wid/projects/:pid/devices` | `editor` |
| PATCH  | `/api/workspaces/:wid/projects/:pid/devices/:did` | `editor` |
| POST   | `/api/workspaces/:wid/projects/:pid/devices/:did/token` | `editor` |
| DELETE | `/api/workspaces/:wid/projects/:pid/devices/:did` | `editor` |
| GET    | `/api/workspaces/:wid/projects/:pid/devices/:did/values` | `viewer` |
| GET    | `/api/workspaces/:wid/projects/:pid/devices/:did/series?key=&range=` | `viewer` |
| PUT    | `/api/workspaces/:wid/projects/:pid/devices/:did/values/:key` | `editor` |
| POST   | `/api/device/v1/telemetry` | device token |
| GET    | `/api/device/v1/controls` | device token |

Creating a device or rotating its token returns `{ device, token }`. The token is shown
only then; the server stores its SHA-256. A device view is `{ id, name, tokenHint,
lastSeenAt, online, createdAt }`, and `online` means the device was heard from in the last
60 seconds. `values` returns `{ deviceId, online, lastSeenAt, values: { key: { value,
source, updatedAt } } }`. `series` takes `range` = `1h` | `24h` | `7d` | `30d` and returns
at most 120 averaged `{ at, value }` points.

Boards send `Authorization: Device <token>` (or `X-Device-Token`).
`POST telemetry { values: { key: value } }` accepts up to 32 values per report and returns
`{ accepted, rejected }`. A value is checked against its datastream's type: `number` must
be a finite number, `boolean` must be true, false, 0, or 1, and `string` must be at most
256 characters. Each device may send a burst of 10 reports, then one per second.
`GET controls` returns `{ values }`, the values dashboard controls set.

### Error codes

`DEVICE_NOT_FOUND` (404), `DEVICE_LIMIT_REACHED` (409), `DEVICE_TOKEN_INVALID` (401),
`TELEMETRY_TOO_MANY_VALUES`, `TELEMETRY_INVALID_VALUE`, `INVALID_DATASTREAM_KEY` (400),
`TELEMETRY_RATE_LIMITED` (429), `DATASTREAM_NOT_FOUND` (404).

## Connections

| Method | Path                                                  | Required role |
| ------ | ----------------------------------------------------- | ------------- |
| GET    | `/api/workspaces/:wid/projects/:pid/connections`      | `viewer`      |
| POST   | `/api/workspaces/:wid/projects/:pid/connections`      | `editor`      |
| PATCH  | `/api/workspaces/:wid/projects/:pid/connections/:cid` | `editor`      |
| DELETE | `/api/workspaces/:wid/projects/:pid/connections/:cid` | `editor`      |

`POST` accepts `{ from: { componentId, pinId }, to: { componentId, pinId },
color?, kind?, waypoints? }`.

Endpoints are pins, never coordinates, so moving a component preserves its wires.
`A → B` and `B → A` are the same connection: the unique index orders the pair
before comparing, which is what an electrical node actually is.

`PATCH` replaces the manual bend points. **An empty array resets the wire to
automatic routing** — only hand-placed bends are stored, and the rest of the path
is computed at render time so a routing improvement reaches existing projects.

Deleting a component cascades to its wires, so a connection never points at a
component that no longer exists.

### Additional error codes

`COMPONENT_LIMIT_REACHED`, `CONNECTION_LIMIT_REACHED`, `COMPONENT_NOT_FOUND`,
`CONNECTION_NOT_FOUND`, `CONNECTION_ALREADY_EXISTS`, `CONNECTION_SELF_LOOP`,
`BOARD_NOT_FOUND`, `TOO_MANY_WAYPOINTS`, `INVALID_WAYPOINT`,
`SUBSCRIPTION_MISSING`, `BOARD_LIMIT_REACHED`.

`BOARD_LIMIT_REACHED` is returned when adding another development board to a
project. The initial board created with the project is the one allowed board.

Limit refusals carry `limit`, `used`, and `planCode` alongside the message, so the
client can explain the ceiling instead of failing generically.

## Community (2026-09-22)

The only endpoints on the platform whose reads are open to anonymous callers.
`GET` handlers use `OptionalSupabaseAuthGuard`: a request without an
`Authorization` header is served as a visitor, while a header that fails
verification is still rejected with 401 so the client refreshes and retries
instead of silently losing the viewer's own votes. Every write uses
`SupabaseAuthGuard` and is additionally throttled by
`THROTTLE_OVERRIDES.communityWrite` (20/min), because a public write endpoint is
reachable by every account on the platform.

| Method | Path                                    | Auth      |
| ------ | --------------------------------------- | --------- |
| GET    | `/api/community/tags`                   | public    |
| GET    | `/api/community/posts`                  | optional  |
| GET    | `/api/community/posts/:slug`            | optional  |
| POST   | `/api/community/posts`                  | required  |
| PATCH  | `/api/community/posts/:postId`          | author    |
| DELETE | `/api/community/posts/:postId`          | author or platform admin |
| POST   | `/api/community/posts/:postId/vote`     | required  |
| GET    | `/api/community/posts/:postId/comments` | optional  |
| POST   | `/api/community/posts/:postId/comments` | required  |
| PATCH  | `/api/community/comments/:commentId`    | author    |
| DELETE | `/api/community/comments/:commentId`    | author or platform admin |
| POST   | `/api/community/comments/:commentId/vote`   | required |
| POST   | `/api/community/comments/:commentId/accept` | post author |

`GET /posts` accepts `sort` (`new` \| `top` \| `active`), `tag`, `authorId`, `q`,
`limit` (≤ 50), and `cursor`. Pagination is **keyset**, and `meta.nextCursor` is
opaque: it encodes the sort column's value plus the row id, so a page stays
stable while posts are created and voted on above it. A cursor that does not
decode restarts the feed rather than returning 400 — the client never built it,
so a stale one is not its error. A short page is the last page.

Post summaries include `excerpt` (plain text, up to 280 characters plus ellipsis)
and `markdownPreview` (the first 1,200 characters of the original Markdown,
preserving line breaks, tables, and code fences), plus `markdownPreviewTruncated`
to indicate that the source was cut short. The feed renders the latter
through the shared sanitizing Markdown pipe in a compact preview without an inner
scrollbar. The "เพิ่มเติม" button fetches the detail endpoint's complete `body`,
shows a content skeleton while waiting, and expands in place. Collapsing and
re-expanding reuse that body for the lifetime of the card. Older API deployments without
`markdownPreview` remain readable through the plain-text excerpt.

`POST /posts` accepts `{ kind?, title, body, tags }`. `tags` are slugs from the
curated catalog seeded by the community migration; unknown slugs are refused with
`COMMUNITY_TAG_UNKNOWN` and the offending slugs. Tags are not free text on
purpose — an open tag space fills with near-duplicates that are far more work to
merge later than to seed now.

Vote bodies are `{ value: -1 | 0 | 1 }`, where `0` withdraws the vote. Scores are
never written by the API: a database trigger applies the delta when the vote row
changes, so the number stays correct on paths the API never sees, including the
cascade when an account is deleted. The response carries the score read back
afterwards.

`POST /comments/:id/accept` **toggles** — accepting the already-accepted answer
clears it. Only a top-level answer can be accepted, and only by the asker.
Replies nest one level deep; a reply to a reply is refused rather than flattened.

### Error codes

`COMMUNITY_POST_NOT_FOUND`, `COMMUNITY_COMMENT_NOT_FOUND`,
`COMMUNITY_POST_NOT_OWNED`, `COMMUNITY_COMMENT_NOT_OWNED`,
`COMMUNITY_TAG_UNKNOWN`, `COMMUNITY_PARENT_MISMATCH`, `COMMUNITY_REPLY_TOO_DEEP`,
`COMMUNITY_REPLY_NOT_ACCEPTABLE`, `COMMUNITY_POST_CLOSED`,
`COMMUNITY_POST_LIMIT_REACHED`.

`COMMUNITY_POST_LIMIT_REACHED` carries `limit` and `used`. It is a rolling
per-author daily ceiling (15), which bounds what a patient spammer can do over a
day; the per-minute throttle does not.

---

# Usage Examples (2026-10-18)

Shapes below follow the implemented controllers. Values are illustrative. Responses
are returned unwrapped (no `{ data }` envelope) except `GET /api/health`; errors
always use the error envelope.

Set these once in the shell:

```sh
API=http://localhost:3000/api
SUPABASE_URL=https://<project-ref>.supabase.co
PUBLISHABLE_KEY=<publishable key>
```

## 1. Health check

```sh
curl $API/health
```

```json
{ "data": { "status": "ok" } }
```

## 2. Get an access token

The API issues no tokens. Sign in against Supabase Auth (the Angular app does the
same) and use `access_token` as the bearer token:

```sh
curl -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"email":"maker@example.com","password":"<password>"}'
```

```sh
TOKEN=<access_token from the response>
```

## 3. Current profile and workspaces

```sh
curl $API/auth/me -H "Authorization: Bearer $TOKEN"
curl $API/workspaces -H "Authorization: Bearer $TOKEN"
```

```json
[
  { "id": "6f1c…", "name": "Maker's workspace", "slug": "maker", "ownerId": "a2d4…", "role": "owner" }
]
```

```sh
WID=6f1c…
```

## 4. Create a project

```sh
curl -X POST $API/workspaces/$WID/projects \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Room monitor","boardId":"esp32-devkit-v1","framework":"Arduino C++","deviceIds":["dht22"]}'
```

`201`: the project with its persisted `components` (the board plus the DHT22). Choose
`boardId`, `framework`, and peripheral ids from `GET /api/boards`.

```json
{
  "id": "0b7e…", "workspaceId": "6f1c…", "name": "Room monitor", "slug": "room-monitor",
  "description": "", "board": "esp32-devkit-v1", "framework": "Arduino C++",
  "createdAt": "2026-10-18T09:00:00.000Z", "updatedAt": "2026-10-18T09:00:00.000Z",
  "components": [ { "id": "…", "definitionId": "esp32-devkit-v1", "label": "…", "x": 0, "y": 0, "rotation": 0, "state": {} } ]
}
```

```sh
PID=0b7e…
```

## 5. Read and save a file with a version check

```sh
curl "$API/workspaces/$WID/projects/$PID/file?path=main.ino" -H "Authorization: Bearer $TOKEN"
```

```json
{ "path": "main.ino", "content": "void setup() {}\nvoid loop() {}\n", "sizeBytes": 31, "contentHash": "9f2c…", "version": 1, "updatedAt": "…" }
```

Save, stating the version that was read:

```sh
curl -X PUT $API/workspaces/$WID/projects/$PID/file \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"path":"main.ino","content":"void setup() { Serial.begin(115200); }\nvoid loop() {}\n","expectedVersion":1}'
```

```json
{ "path": "main.ino", "sizeBytes": 55, "contentHash": "41ab…", "version": 2, "updatedAt": "…", "created": false }
```

If another tab saved first, the same request returns `409`:

```json
{
  "error": {
    "code": "FILE_VERSION_CONFLICT",
    "message": "This file changed since you last loaded it. Reload before saving again.",
    "requestId": "req-…",
    "currentVersion": 3,
    "currentHash": "77d0…"
  }
}
```

## 6. Compile firmware

```sh
curl -X POST $API/workspaces/$WID/projects/$PID/builds -H "Authorization: Bearer $TOKEN"
```

`202`:

```json
{
  "build": {
    "id": "c3a9…", "projectId": "0b7e…", "status": "queued", "boardId": "esp32-devkit-v1",
    "failureReason": null, "durationMs": null, "createdAt": "…", "startedAt": null, "finishedAt": null,
    "artifacts": [], "flash": { "protocol": "esptool", "baudRate": 460800 }
  },
  "reused": false
}
```

Poll until `status` is `succeeded`, `failed`, or `canceled`, then download the images:

```sh
curl $API/workspaces/$WID/projects/$PID/builds/c3a9… -H "Authorization: Bearer $TOKEN"
curl -o firmware.bin $API/workspaces/$WID/projects/$PID/builds/c3a9…/artifacts/firmware.bin \
  -H "Authorization: Bearer $TOKEN"
```

## 7. Register a device and send telemetry

```sh
curl -X POST $API/workspaces/$WID/projects/$PID/devices \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Living room"}'
```

```json
{ "device": { "id": "d41e…", "name": "Living room", "tokenHint": "…9xQ2", "lastSeenAt": null, "online": false, "createdAt": "…" }, "token": "<shown once>" }
```

The board reports with its own token, not a user token:

```sh
curl -X POST $API/device/v1/telemetry \
  -H "Authorization: Device <device token>" -H "Content-Type: application/json" \
  -d '{"values":{"temperature":27.4,"humidity":61}}'
```

```json
{ "accepted": ["temperature"], "rejected": [{ "key": "humidity", "reason": "No datastream with this key" }] }
```

A key is accepted only when the project has a datastream with that key and type;
create datastreams in the dashboard builder first.

The same call from an ESP32 sketch:

```cpp
HTTPClient http;
http.begin("https://<host>/api/device/v1/telemetry");
http.addHeader("Content-Type", "application/json");
http.addHeader("Authorization", String("Device ") + DEVICE_TOKEN);
http.POST("{\"values\":{\"temperature\":" + String(t, 2) + "}}");
http.end();
```

## 8. Ask the IoT advisor

```sh
curl -X POST $API/ai/advisor/chat \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"advice","messages":[{"role":"user","content":"Which pins can I use for a DHT22 on an ESP32?"}]}'
```

```json
{ "id": "…", "model": "…", "vendor": "google", "profile": "balanced", "autoSelected": true, "content": "…", "createdAt": "…" }
```

## Common errors

| Status | `error.code` | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST` / `INVALID_FILE_PATH` | DTO validation failed or the path is unsafe |
| 401 | `UNAUTHORIZED` | Missing, expired, or forged token |
| 404 | `WORKSPACE_NOT_FOUND` / `PROJECT_NOT_FOUND` | Not found **or** not a member. Never 403, so ids cannot be probed |
| 409 | `FILE_VERSION_CONFLICT`, `BUILD_ALREADY_ACTIVE`, … | State changed; the body carries the current state |
| 429 | `TOO_MANY_REQUESTS` / `AI_RATE_LIMITED` | Platform throttle, or the AI provider's quota |
| 503 | `AUTH_NOT_CONFIGURED` / `BUILD_WORKER_NOT_CONFIGURED` | Server configuration missing |
