# Page Inventory

Every route the application serves, what backs it today, and what is missing before
it can be called real. Update the Status column whenever you finish a page.

Status values: **Real** (backed by a live endpoint), **Partial** (works, but some
data or action is faked or unsaved), **Simulated** (renders convincing data with no
backend), **Orphan** (calls an endpoint that does not exist).

Verify a row before trusting it — this table is a starting point, not an oracle.
Confirm with `grep -n "apiUrl" <page>.service.ts` and by checking that the module
exists under `backend/src/modules/`.

## Public

| Route | Files | Status | Work to make it real |
| --- | --- | --- | --- |
| `/home` | `features/main/home/` | Real (static) | Content only. Keep it static. |
| `/pricing` | `features/main/pricing/` | Hidden | Redirects to `/home`; public navigation and the home pricing CTA are removed. The component is retained for future use. |

## Auth

| Route | Files | Status | Work to make it real |
| --- | --- | --- | --- |
| `/auth/login`, `/auth/signup` | `features/auth/` | Real | Supabase Auth. See `docs/adr/ADR-003-supabase-auth-migration.md`. |
| `/auth/callback` | `features/auth/callback/` | Real | Deliberately outside `guestGuard`. Do not move it. |

## User

| Route | Files | Status | Work to make it real |
| --- | --- | --- | --- |
| `/user/projects` | `features/user/projects/` | Partial | Creation persists board/peripherals; card actions open IDE/Virtual Device and delete through the authorized API with confirmation and retry. Usage is accessed through the sidebar. Deployment status still needs backend state. See `docs/pages/user-projects.md`. |
| `/user/projects/:id/ide` | `features/user/workspace/project-workspace.page.ts` (~1600 lines) | Partial | Files live in the database (`ADR-004`). Build runs in the isolated builder (`ADR-002`); upload and serial use Web Serial via `workspace/firmware/`. Verified against real builder containers and an emulated optiboot, not yet on a physical board. Split the page — see `WORKING-AGREEMENT.md` § 4. |
| `/user/projects/:id/virtual-device` | `features/user/workspace/virtual-device/` (page ~2630 lines) | Partial | Components and connections persist through `projects`. Simulation state does not. Decide what must survive a reload and write only that. Firmware now runs: a subset Arduino interpreter under `simulation/firmware/` drives board GPIO pins through the existing behaviour contract, loaded from the project's own `.ino`/`.cpp` on Start (`ADR-005`). Verified by `scripts/verify-firmware.ts`, 29 checks against the real solver. |
| `/user/projects/:id/dashboard` | `features/user/workspace/dashboard-builder/` | Partial | Layout is saved to `localStorage` only (`dashboard-builder.page.ts` ~878, ~921). Needs a persistence endpoint under the project. |
| `/docs`, `/user/documents` | `features/user/documents/` | Partial | Shared public/signed-in catalog with 16 Thai guides from `guides/*.md`, bundled as text and rendered through `MarkdownPipe`. Covers project, IDE, simulation, AI, dashboard, community, and troubleshooting workflows. Device references derive from the live catalog. See `docs/pages/user-documents.md` for scope and limitations. No authoring endpoint or manufacturer PDF uploads. |
| `/user/assistant` | `features/user/assistant/` | Real | IoT advisor: advice (devices, wiring, Arduino IDE / PlatformIO code) and error-log analysis through `POST /api/ai/advisor/chat`. Minimal white chat layout, suggestion chips, an auto-growing composer with no manual resize handles, and a header action for new conversations. Error analysis uses a compact form with segmented toolchain radios, a log character count, and an optional code disclosure that preserves its content and exposes validation while collapsed. Conversation is page-local by design. |
| `/user/plan` | `features/user/plan/` | Hidden | Redirects to `/user/projects`; entry points in the sidebar, public account menu, and account settings are removed. The component is retained for future use. |
| `/user/settings` | `features/account/profile/` | Real | Profile, email/password, and login history; AI Profiles is removed from account settings. Profile details and private avatar use authorized APIs, email/password use Supabase Auth. Shared with admin profile. See `docs/pages/user-settings.md` for verification and provider limitations. |

## Admin

| Route | Files | Status | Work to make it real |
| --- | --- | --- | --- |
| `/admin/dashboard` | `features/admin/dashboard/` | Real | Platform counts, API-process resources, PostgreSQL health, and request summaries come from `admin-monitoring`. See `../pages/admin-operations.md`. |
| `/admin/server` | `features/admin/server-monitoring/` | Real | Polls measured NestJS process, filesystem, and PostgreSQL health. Unsupported container controls were retired. See `../pages/admin-operations.md`. |
| `/admin/logs` | `features/admin/system-logs/` | Real (process-local) | Shows a bounded, secret-free request log from the active NestJS process. It resets on deploy and is not a durable audit log. See `../pages/admin-operations.md`. |
| `/admin/database` | `features/admin/database/` | Real | Read-only primary PostgreSQL metrics through `admin-database`, with backend admin authorization. Unsupported backup calls and controls retired. See `../pages/admin-database.md` for scope and verification. |
| `/admin/integrations` | `features/admin/integrations/` | Real | AI management: shared primary/fallback models, credit limits, reset schedules, and usage. The service-status section is retired. |
| `/admin/settings` | retired | Removed | The page claimed to enforce maintenance mode and send alerts, but neither capability existed. It was removed instead of persisting settings that no runtime consumed. |
| `/admin/users` | `features/admin/user-management/` | Real | `admin-users` module. |
| `/admin/ai-assistant` | `features/admin/ai-assistant/` | Real | `ai` module via OpenRouter. |
| `/admin/profile` | `features/account/profile/` | Real | Shared account settings page; profile API and Supabase Auth. See `docs/pages/user-settings.md`. |

## Order of work

1. Orphans first — a page that calls a missing endpoint is broken, not incomplete.
   For each: build the module, or delete the page and its service, model, and route.
2. Then the simulated admin trio (dashboard, server, logs) — decide as one, since
   they share `ServerMonitoringStore`.
3. Then user-facing persistence gaps: dashboard builder, documents, virtual device.
4. Then the AI generator work in `AI-GENERATION.md`.
5. Split the three oversized pages as you touch them, not as a separate campaign.

Deleting a page is a legitimate outcome. Run `DEAD-CODE.md` first and record the
decision in the page brief.
