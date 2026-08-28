# API

## Base Route

Use versioned APIs.

Example:

`/api/v1`

## Controllers

Controllers should:

* receive validated requests
* call services
* map results to HTTP responses

Controllers should not contain:

* SQL
* complex business logic
* direct payment verification logic
* large authorization workflows

## DTOs

Validate all external input.

Use DTOs for:

* request body
* route parameters
* query parameters

Do not trust Angular validation as a security boundary.

## Success Response

Recommended structure:

{
"data": {},
"meta": {}
}

Use `meta` for:

* pagination
* cursors
* totals
* additional response metadata

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

* ProjectNotFoundError
* ProjectAccessDeniedError
* DeviceOfflineError
* BuildTimeoutError
* QuotaExceededError

Map domain errors centrally to HTTP responses.

Do not repeat try/catch logic in every controller.

## Authorization

Every protected endpoint must authorize on the backend.

Depending on the resource, check:

* user identity
* workspace membership
* role
* ownership
* entitlement

## Pagination

Do not return unlimited collections.

Support pagination.

Use cursor pagination when collections can become large.

## Realtime

Use WebSocket for interactive realtime flows such as:

* telemetry updates
* dashboard state
* build status
* device online/offline events

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

* payment webhooks
* subscription updates
* some provisioning operations

## Rate Limiting

Apply stricter limits to:

* authentication
* AI
* build requests
* device provisioning
* expensive searches
* public write endpoints

---

# Implemented Endpoints (2026-08-28)

Base prefix is `/api`. The `/api/v1` move is still outstanding — see
`docs/ARCHITECTURE.md`.

## Authentication

Registration, login, logout, refresh, password reset, and OAuth are performed by
the Angular client directly against Supabase Auth. The API issues no tokens.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/auth/me` | Supabase token | Application profile |
| PATCH | `/api/auth/me` | Supabase token | Username only; email belongs to Supabase |
| GET | `/api/auth/availability` | public | Throttled; enumeration oracle |

## Workspaces

| Method | Path | Required role |
| --- | --- | --- |
| GET | `/api/workspaces` | membership (scoped in the query) |
| GET | `/api/workspaces/:workspaceId/members` | `viewer` |

## Projects and files

All scoped by workspace. Each handler checks the caller's workspace role **and**
that the project belongs to that workspace; without the second check a member of
any workspace could reach any project by id.

| Method | Path | Required role |
| --- | --- | --- |
| GET | `/api/workspaces/:wid/projects` | `viewer` |
| POST | `/api/workspaces/:wid/projects` | `editor` |
| DELETE | `/api/workspaces/:wid/projects/:pid` | `admin` |
| GET | `/api/workspaces/:wid/projects/:pid/files` | `viewer` |
| GET | `/api/workspaces/:wid/projects/:pid/file?path=` | `viewer` |
| PUT | `/api/workspaces/:wid/projects/:pid/file` | `editor` |
| PUT | `/api/workspaces/:wid/projects/:pid/files` | `editor` — batch autosave |
| DELETE | `/api/workspaces/:wid/projects/:pid/file?path=` | `editor` |

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
`AUTH_NOT_CONFIGURED`, `BUILD_TEMPORARILY_DISABLED`, `SERIAL_TEMPORARILY_DISABLED`.

A workspace or project the caller cannot see returns **404, not 403** — a 403 would
confirm the id exists.

## Deprecated

`/api/projects/:projectId/workspace/*` still serves files from the API filesystem
and is scoped by user id rather than by workspace membership. It is superseded by
the endpoints above and is removed once the Angular IDE is switched over.
