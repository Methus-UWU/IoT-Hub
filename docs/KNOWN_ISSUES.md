# Known Issues and Future Plans

Updated 2026-10-18.

This file is the index of what is known to be missing, limited, or wrong, and what is
planned next. Each entry links to the document that holds the detail; when an entry is
closed, update the source document and remove the row here.

Severity:

- **High** — a security or data-integrity concern, or a blocker for a public release.
- **Medium** — a visible limitation or an architectural gap.
- **Low** — cosmetic, documentation, or operational inconvenience.

## Known issues and limitations

### Platform and API

| # | Issue | Severity | Detail |
| --- | --- | --- | --- |
| 1 | The API is not versioned. The base prefix is `/api`, not `/api/v1`. | Medium | `docs/API.md` § "Implemented Endpoints"; `docs/ARCHITECTURE.md` § "Deferred from Phase 1" |
| 2 | The success envelope `{ data, meta }` is applied only to `GET /api/health`. Other endpoints return their payload unwrapped. Errors already use the `{ error: { code, message, requestId } }` envelope. | Low | `docs/API.md` § "Success Response"; planned together with item 1 |
| 3 | There is no WebSocket gateway yet (Phase 6 has not started). Build status is polled every ~1.5 s, dashboard live values every 5 s, and the admin server page also polls. | Medium | `docs/ARCHITECTURE.md` § "Remaining phases" |
| 4 | The deprecated `/api/projects/:projectId/workspace/file(s)` routes still serve files from the API filesystem, scoped by user id instead of workspace membership. The client no longer calls them. | Medium | `docs/API.md` § "Deprecated" |
| 5 | `compose.yaml` still mounts `.workspace-data` and sets `WORKSPACE_ROOT` and `WORKSPACE_ALLOW_ANONYMOUS` for the legacy routes in item 4. `WORKSPACE_ALLOW_ANONYMOUS` is no longer read by any code. | Low | Remove with item 4 |
| 6 | `compose.yaml` is hard-wired to the original deployment (`unity-hub.connectdb.xyz` and the external Docker network `web`). | Low | `README.md` § "Production"; `docs/DEPLOYMENT.md` |

### Product features

| # | Issue | Severity | Detail |
| --- | --- | --- | --- |
| 7 | Firmware flashing over Web Serial has been verified against real builder containers and an emulated optiboot, not yet on a physical board. | Medium | `docs/agent/PAGE-INVENTORY.md` (IDE row) |
| 8 | Virtual device simulation state is not persisted; only components and connections are. The firmware simulator is a subset Arduino interpreter, not a full emulator. | Medium | `docs/agent/PAGE-INVENTORY.md`; `docs/adr/ADR-005-firmware-simulation.md` |
| 9 | The projects page has no backend deployment status, so it offers no operational filters. | Low | `docs/pages/user-projects.md` § "Follow-ups" |
| 10 | The `/pricing` and `/user/plan` pages are hidden. Plans and entitlements exist (`billing` module), but there is no payment provider. | Medium | `docs/agent/PAGE-INVENTORY.md` |
| 11 | The knowledge base is Markdown bundled with the frontend (`/docs`). There is no backend `knowledge` module. Guide search covers titles only. Manufacturer PDFs are not stored. | Low | `docs/pages/user-documents.md` § "Follow-ups" |
| 12 | Community search uses `ILIKE`, not full-text search, because the PostgreSQL `simple` configuration cannot tokenize Thai. | Low | `docs/DATABASE.md` § "Community tables" |

### AI

| # | Issue | Severity | Detail |
| --- | --- | --- | --- |
| 13 | A free OpenRouter key allows 50 free-model requests per day. One project generation spends several tool rounds of that budget. | Medium | `docs/ARCHITECTURE.md` § "Project AI model reliability" |
| 14 | On Gemini's free tier, prompts and answers may be used by Google to improve its products. Users paste sketches and logs that can contain Wi-Fi credentials or tokens. | High | `docs/ARCHITECTURE.md` § "Project AI model reliability"; `docs/SECURITY.md` § "AI Security" |
| 15 | Project generation and the admin assistant have not been tested against Gemini, so they run on OpenRouter only. | Low | Same as item 13 |

### Operations

| # | Issue | Severity | Detail |
| --- | --- | --- | --- |
| 16 | The admin request log and monitoring data are process-local. They reset on deploy, are not a durable audit log, and do not aggregate across replicas. | Medium | `docs/pages/admin-operations.md` |
| 17 | There is no in-app backup or restore. Database backups depend on Supabase. | Medium | `docs/pages/admin-database.md` § "Follow-ups" |
| 18 | Migrations are not applied automatically on deploy. They must be applied through the reviewed database workflow first. | Low | `docs/DEPLOYMENT.md` § "Configuration" |

### Security (operator actions)

| # | Issue | Severity | Detail |
| --- | --- | --- | --- |
| 19 | Real AI keys exist in plaintext in an untracked local `backend/.env`. Rotate them at the provider. | High | `docs/SECURITY.md` § "Manual actions required" |
| 20 | The legacy local database still contains accounts with a previously leaked password. Drop it, or change those passwords, once nothing depends on it. | High | `docs/SECURITY.md` § "Superseded manual actions" |

### Code and documentation debt

| # | Issue | Severity | Detail |
| --- | --- | --- | --- |
| 21 | Several page components are too large: `virtual-device.page.ts` (~3,160 lines), `project-workspace.page.ts` (~1,570 lines), and `dashboard-builder.page.ts` (~1,200 lines). | Medium | `docs/agent/WORKING-AGREEMENT.md` |
| 22 | Frontend duplication of browser storage access and signal-store boilerplate is still open (findings P8, P9). | Low | `docs/LEGACY_AUDIT.md` § "Remediation Status" |
| 23 | `ai_settings.fallback_models` is nullable in SQL but non-nullable in `schema.prisma`, because Prisma cannot declare a nullable list. | Low | Found while regenerating the ER diagram (`docs/diagrams/`) |
| 24 | The first status table in `docs/ARCHITECTURE.md` § "Migration Status" is dated 2026-08-28 and is out of date. § "Remaining phases" in the same file is current. `docs/agent/PAGE-INVENTORY.md` still says the dashboard layout is saved only to `localStorage`, but it now persists through the dashboards API. | Low | Update both documents |

## Future plans

### Next phases

1. **Phase 6: Realtime.** Add the WebSocket gateway with the versioned events from
   `docs/API.md` (`build.status.changed`, `telemetry.updated`,
   `device.status.changed`) and replace the polling in item 3.
2. **API versioning.** Move to `/api/v1` and apply the success envelope in the same
   change, together with the frontend `environment.apiUrl` (items 1 and 2).
3. **Legacy cleanup.** Delete the deprecated workspace file routes, the
   `.workspace-data` mount, and the unused environment variables (items 4 and 5).
4. **Phase 7: remaining domains.** Billing with a payment provider (then re-enable the
   pricing and plan pages), and a backend knowledge domain if guides need to be
   authored outside the frontend bundle.

### Product

- Verify firmware upload on physical ESP32 and Arduino Uno/Nano boards.
- Decide which simulation state must survive a reload, and persist only that.
- Persist deployment/build status per project and expose it on the projects page.
- Documents: store manufacturer PDFs in Supabase Storage, search guide bodies, and
  link devices to the guides that use them.
- Thai-aware full-text search (pgroonga or pg_bigm) once community content outgrows
  a sequential scan.

### Operations

- An external metrics and logging backend before running more than one API replica.
- A separately scoped backup/restore work item (retention, durable storage, job
  tracking, authorization, audit, restore tests).
- A deployment control plane before the admin UI offers restart, stop, backup, or
  restore actions.

### Engineering

- Split the large page components (item 21) following `docs/agent/WORKING-AGREEMENT.md`.
- Introduce the shared `BrowserStorageService` and signal-store helper (item 22).
- Keep the modular monolith. Build workers, AI workers, telemetry ingestion, and the
  WebSocket gateway are the only candidates for extraction, and only when an
  operational need justifies it (`docs/ARCHITECTURE.md` § "Future Scalability").
