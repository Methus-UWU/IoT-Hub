# Admin operations pages

- Routes: `/admin/dashboard`, `/admin/server`, `/admin/logs`
- Frontend: `frontend/src/app/features/admin/`
- Backend: `backend/src/modules/admin-monitoring/`
- Status: Real, with documented process-local limits
- Last verified: 2026-09-29

## What the administrator can do

- Read real platform counts from PostgreSQL.
- Watch CPU and RSS memory for the NestJS process, filesystem usage, process uptime,
  operating-system load, PostgreSQL latency, and active database connections.
- Review recent HTTP request outcomes, durations, and correlation ids.
- Check PostgreSQL connectivity in server monitoring.
- Retry failed reads from every page.

## Data ownership

`/admin/integrations` is now labeled AI management and contains only model and
credit settings. Its service-status cards and status fetch were removed; the
protected backend status endpoint remains available independently of that page.

`AdminMonitoringService` owns runtime sampling. Database counts and health go through
`AdminMonitoringRepository`; `PrismaAdminMonitoringRepository` is the only Prisma
implementation. `RequestLoggingInterceptor` records completed API requests in the
bounded `AdminRequestLogStore`. The Angular `ServerMonitoringStore` polls the protected
snapshot endpoint every five seconds and converts wire timestamps to `Date` objects.

Both controllers use the existing Supabase authentication and current-database
platform-admin authorization. They return no secrets and opt out of HTTP caching.

## Deliberate limits

- Metrics describe the NestJS process and its mounted filesystem, not every container
  or the physical host.
- Request logs are capped at 200 entries, process-local, and reset on deploy. They are
  not an audit ledger and contain no headers, query strings, bodies, tokens, or IPs.
- Supabase and OpenRouter status means required server configuration is present. Their
  network calls remain checked by the features that use them. PostgreSQL connectivity
  is tested directly on the integrations page.
- Container restart/stop buttons, invented websites, network/disk I/O, backup status,
  online device counts, and fake AI quotas were removed because the application cannot
  measure or control them.
- Dynamic provider keys are not stored. The process environment remains the credential
  source of truth, so the admin UI cannot disclose or mutate secrets.

The former `/admin/settings` page was also retired. It claimed maintenance mode would
block non-admin traffic and alert email would receive notifications, but no runtime
consumed either value. Persisting that form would have made the page look successful
without changing system behaviour.

## Dead-code decision

The random `ServerMonitoringService`, fake service controls, create/test/delete
integration client, and orphan settings route were unfinished implementations named in
the page inventory. Route, symbol, model, and documentation searches found no backend
contract or test that made those behaviours real. They were replaced or retired as one
coherent admin-operations change; generated files were not touched.

## Verification

- Backend build passed.
- Targeted backend lint passed for `src/modules/admin-monitoring/*.ts`.
- All 32 backend suites / 358 tests passed, including four focused tests for
  request-log privacy/aggregation and measured or unavailable database states.
- Frontend production build passed.
- Frontend verification scripts passed: device, firmware, firmware loader, layout,
  relay switching, and peripheral projects.
- A read-only live repository check returned 13 users, 11 projects, 10 project files,
  4 community posts, and PostgreSQL health with 9 active connections.
- Both production Docker images built, and the isolated smoke stack passed runtime,
  non-root, database, SPA deep-link, asset-cache, CORS, API-proxy, and authorization
  checks. The public cutover remains pending because the running images could not be
  tagged for rollback after the build replaced the local `production` tags.

## Follow-ups

1. Use an external metrics/logging backend before operating multiple NestJS replicas or
   requiring durable audit retention.
2. Add a deployment-control plane before offering restart, stop, backup, or restore
   actions in this UI.
