# /admin/database — Database status

- Route: `/admin/database`
- Files: `frontend/src/app/features/admin/database/`
- Backend: `backend/src/modules/admin-database/`
- Status: Real (read-only database overview)
- Last verified: 2026-09-06

## What the user can do here

- Read the primary PostgreSQL version and total database size.
- Read current database connections, including idle sessions, and the server limit.
- Refresh the snapshot and see when PostgreSQL measured it.
- See a retryable error when the snapshot cannot be loaded.

## How it works

The component-scoped `DatabaseStore` owns signals and requests through
`DatabaseService`. `GET /api/admin/database/overview` uses the existing authentication
and platform-admin guards. `AdminDatabaseService` depends on
`DatabaseOverviewRepository`; `PrismaDatabaseOverviewRepository` reads PostgreSQL
statistics through the primary client in a bounded read-only transaction. No new
tables or migrations are needed. See [API contract](../API.md#admin-database-2026-09-06).
Requests are cancelled on component destruction; a failed refresh clears the prior
snapshot, and a pending refresh shows loading rather than stale success.

## What is not real yet

No simulated values remain in this page. Backup listing, creation, deletion and
restore are not offered, and backup availability is explicitly unknown. Those
operations remain with the database operator's tools.

## Decisions made here

Keep this route as a read-only overview. Retire the unsupported `admin/backups`
calls and their UI instead of promising recovery without a recovery system. No
application dependency or hosted paid service was added. Counts for one database are not shown
as a percentage of the server-wide connection limit.

Dead-code checklist verdict: **Keep** the routed page/service/store; **unfinished
feature, explicitly retired in this pass** for backup methods, models, filters,
dialogs and their local styles. Symbol, filename and route searches found only
this page consuming the backup contracts in `admin.model.ts`; no tests cover them.
The separately named `BackupStatus` in `server-metrics.model.ts` belongs to the
admin monitoring trio and is unchanged. Nothing removed is generated. The nested
frontend Git history shows checkpoint `b8424c2` for the page; the backup service,
store, template and shared admin model were untracked at the start. Inventory and
legacy-audit references were updated together. The user's standing brief explicitly
authorizes building orphan routes or retiring unsupported calls.

## Verification

- `backend`: `npm.cmd run build` — passed after resolving the Prisma overload.
- `backend`: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  — passed, including test source types.
- `backend`: `npm.cmd test -- --runInBand admin-database authorization.service`
  — 23 tests passed, covering missing/invalid tokens, non-admin/suspended/missing
  profiles, demotion, aggregate response allowlist, no-store and safe failure.
- `backend`: `npm.cmd test -- --runInBand` — all 16 suites / 232 tests passed.
- `backend`: `node node_modules/eslint/bin/eslint.js src/modules/admin-database/*.ts`
  — passed without warnings after typing the test HTTP server/error responses.
- `frontend`: `npm.cmd run build` — passed; existing initial-bundle and unrelated
  component-style budget warnings remain.
- Live repository query with local `.env` loaded by Node — passed against
  PostgreSQL 17.6; positive database size, connection counts and server timestamp.
  Initial sandbox connection failed with `EACCES`; scoped network escalation passed.
- Root: `node --env-file=backend/.env .tmp/admin-database/verify-api.cjs` — the
  full AppModule boots on loopback; registered endpoint rejects missing/invalid tokens.
- Root: `node --env-file=backend/.env .tmp/admin-database/verify-browser.cjs`
  — desktop/mobile rendering, loading, keyboard refresh, 403 clearing, retry and
  absence of obsolete backup requests passed; no browser runtime errors. Axe-core
  4.12.1 found zero violations scoped to this page on both viewports. Temporary
  tool evaluation and screenshots are under `.tmp/admin-database/`.
- Browser success data was queried by the production service/repository per request
  and fulfilled by the test harness; browser route guards were bypassed in memory
  only after checking the anonymous redirect. This is not a signed-in admin E2E test.
  Initial keyboard-refresh verification raced the response; waiting for it fixed
  the harness. No authentication bypass was added to application source.

## Follow-ups

1. If in-app recovery is required, scope a separate backup/restore work item with
   retention, durable storage, job tracking, authorization, audit and restore tests.
