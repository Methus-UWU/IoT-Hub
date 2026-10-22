# Legacy Audit

Read-only audit of the existing repository. No source code, packages, files, or database schema were modified while producing this document.

- Audit date: 2026-08-28
- Scope: `frontend/` (Angular), `backend/` (NestJS + Prisma)
- Target architecture: Angular + NestJS + Supabase (PostgreSQL / Auth / Storage)
- Related documents: `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DATABASE.md`, `docs/API.md`

---

## 1. Repository Shape

| Item | Value |
| --- | --- |
| Root repository | `iot-hub/` — tracks nothing yet; `backend/` and `frontend/` appear as untracked |
| Frontend repository | `frontend/.git` — 2 commits, large uncommitted working tree |
| Backend repository | `backend/.git` — **0 commits**, everything untracked |
| Frontend stack | Angular 22, Tailwind CSS 4, Monaco Editor, `marked`, RxJS 7, TypeScript 6 |
| Backend stack | NestJS 11, Prisma 7 (`pg` driver adapter + read-replica extension), Passport JWT, bcrypt, class-validator |
| Frontend source files | 196 files, ~45,600 lines of `.ts` / `.html` / `.css` |
| Backend source files | 38 TypeScript files, ~2,870 lines (excluding the generated Prisma client) |
| Automated tests | 1 backend spec (`workspace.service.spec.ts`), 0 frontend specs |

Three nested Git repositories exist with no submodule or workspace configuration linking them. The root repository cannot track `backend/` or `frontend/` as ordinary directories while their inner `.git` directories are present. This must be resolved before any migration branch strategy is meaningful.

---

## 2. Current Frontend Architecture

### 2.1 Structure

```
src/app/
  core/        guards, interceptors, models, services (auth, crud, logger)
  shared/      11 presentational components, 2 pipes
  layouts/     auth-layout, main-layout
  features/
    main/      home, pricing, nav
    auth/      login, signup
    user/      projects, documents, plan, user-shell, workspace/
    admin/     admin-shell + 9 admin pages
```

The structure already matches the conventions in `AGENTS.md`: standalone components, lazy `loadComponent` routes, Signals for state, `DestroyRef`, functional guards and interceptors, feature-local services and stores, generic UI in `shared/`.

### 2.2 Routing and access control

`src/app/app.routes.ts` defines four route trees: public (`/home`, `/pricing`), `/auth` behind `guestGuard`, `/user` behind `authMatchGuard` + `authGuard` + `userRoleGuard`, `/admin` behind `authMatchGuard` + `authGuard` + `adminRoleGuard`. Every page is lazily loaded.

### 2.3 Data access

- `CrudService` (`core/services/crud.service.ts`) returns a typed `CrudResource<T>` bound to a resource path. Correct pattern, sound abstraction.
- `WorkspaceApiService` calls the workspace endpoints directly with `HttpClient` — appropriate, since these are actions rather than CRUD.
- Feature stores (`*.store.ts`) hold Signal state and call feature services. Components do not call `HttpClient` directly, matching the documented rule.

### 2.4 What is real and what is simulated

| Frontend feature | Backend endpoint | Status |
| --- | --- | --- |
| Login / register / refresh / logout / profile | `/api/auth/*` | Real |
| Admin user management | `/api/admin/users` | Real |
| Admin AI assistant | `/api/admin/ai/*` | Real |
| Web IDE files, build, devices, serial | `/api/projects/:projectId/workspace/*` | Real |
| Admin database overview | `admin/database/overview` | Resolved 2026-09-06: real read-only metrics; unsupported backup/restore UI retired. See [page brief](pages/admin-database.md). |
| Admin integrations | `admin/integrations` | Resolved 2026-09-29: read-only operational configuration and PostgreSQL connectivity status. |
| Admin settings | — | Retired 2026-09-29: the unused form promised maintenance enforcement and alert delivery that did not exist. |
| Admin dashboard / server monitoring / system logs | `admin/monitoring/snapshot` | Resolved 2026-09-29: measured API-process resources, database-backed counts, PostgreSQL health, and a bounded request-log buffer. |
| Projects list | — | `localStorage` + hardcoded `MOCK_PROJECTS` (`projects/project.store.ts`) |
| Dashboard builder | — | `localStorage` only |
| Virtual device simulator | — | Fully client-side, no persistence contract |

Roughly half of the admin surface renders convincing data that has no backend behind it. `mock-api.interceptor.ts` (400 lines) can serve those endpoints from in-memory fixtures, but `useMockApi` is `false` in both environment files, so today those pages fail against the real API.

---

## 3. Current Backend Architecture

### 3.1 Modules

```
src/
  main.ts                bootstrap: global prefix `api`, cookie-parser, ValidationPipe, CORS
  app.module.ts          ConfigModule(global), PrismaModule(global), Auth, Ai, AdminUsers, Workspace
  common/guards/         JwtAuthGuard, AdminRoleGuard
  prisma/                PrismaService (primary + optional read replica)
  modules/
    auth/                controller, service, DTOs, JWT strategy
    admin-users/         controller, service, DTO
    ai/                  controller, service, system-context, 7 provider adapters
    workspace/           controller, 3 services, access guard, DTOs
```

Four of the fourteen domains named in `docs/ARCHITECTURE.md` exist. `users`, `workspaces`, `projects`, `knowledge`, `community`, `libraries`, `build`, `devices`, `iot`, `telemetry`, `dashboards`, and `billing` are not implemented.

### 3.2 Layering

Controllers are thin and correct. Services carry business logic. **There is no repository layer** — every service calls `this.prisma.db.*` directly, so Prisma types leak into the business layer. This is the single largest obstacle to changing the data access strategy later.

### 3.3 Cross-cutting infrastructure that is missing

No global exception filter, no domain error hierarchy, no standard `{ data, meta }` / `{ error }` response envelope, no API versioning (`/api`, not `/api/v1`), no `helmet`, no rate limiting, no request timeouts, no payload size limits, no structured logging, no health endpoint, no OpenAPI, no WebSocket gateway, no queue. All of these are required by `docs/API.md` and `docs/SECURITY.md`.

---

## 4. Authentication and Session Implementation

### 4.1 Current design

Custom JWT authentication over a local `users` table.

- Access token: 15 minutes, HS256, payload `{ sub, email, role, sid, type: 'access' }`, sent as a `Bearer` header, held only in a frontend Signal (never in `localStorage`).
- Refresh token: 7 days, payload `{ sub, sid, type: 'refresh' }`, delivered in an `httpOnly` cookie scoped to `path=/api/auth`, `sameSite=lax`, `secure` only when `NODE_ENV=production`.
- Sessions persist in the `sessions` table with `ip`, `agent_device`, a bcrypt hash of the refresh token, `expire_at`, `revoke_at`.
- Refresh rotates the token and re-hashes it; logout sets `revoke_at`; changing a password revokes every other session inside a transaction.

### 4.2 Strengths worth preserving as behaviour

Token rotation, hashed refresh tokens at rest, explicit session revocation, the `type` claim check that prevents a refresh token being used as an access token, uniform "Email or password is incorrect" responses, and the frontend's single-flight refresh with `shareReplay` are all sound. **The behaviour should survive the migration even though the implementation will not.**

### 4.3 Weaknesses

| # | Issue | Location |
| --- | --- | --- |
| A1 | No email verification, no password reset. `POST /api/auth/forgot_password` is an empty method that returns 200 to every caller | `auth.controller.ts:145` |
| A2 | No MFA, no login attempt throttling, no account lockout | — |
| A3 | Cloudflare Turnstile is rendered on the login page and the token is sent, but `LoginDto.turnstileToken` is never verified — the CAPTCHA is decorative | `login.dto.ts:12`, `auth.service.ts:46` |
| A4 | Refresh token reuse is not detected. A stolen-then-rotated token simply fails; the session is not invalidated as a breach signal | `auth.service.ts:78` |
| A5 | `sessions.refresh_token` is `@unique` on a bcrypt hash — bcrypt salting makes the constraint meaningless and it costs an index | `prisma/schema.prisma:47` |
| A6 | Expired and revoked sessions are never purged; the table grows without bound | — |
| A7 | bcrypt cost 10 is hardcoded in four separate places | `auth.service.ts`, `admin-users.service.ts`, `prisma/seeds/user.seed.ts` |
| A8 | Access token lifetime is declared twice through different mechanisms (`ACCESS_TOKEN_LIFETIME` constant and `JwtModule` `signOptions`) | `auth.service.ts:22`, `auth.module.ts:19` |
| A9 | Signup enforces only `MinLength(8)`, while change-password and admin update require an uppercase letter and a special character — three password policies in one codebase | `signup.dto.ts` vs `change-password.dto.ts` vs `update-admin-user.dto.ts` |

---

## 5. Authorization and Permission System

Current model: a single `role_id` foreign key from `users` to `roles`, seeded with exactly `admin` and `user`.

- Backend enforcement is `JwtAuthGuard` + `AdminRoleGuard`, where the guard compares `request.user.role` against the literal string `'admin'`. The role is read **from the JWT claim**, not from the database, so a role change does not take effect until the access token expires (up to 15 minutes).
- Frontend `adminRoleGuard` / `userRoleGuard` call `getCurrentUser()` and compare role names. This is UX only, which is correct, but it adds an extra `/auth/me` round trip on every guarded navigation.
- **There is no ownership check anywhere.** Workspace files are isolated only by deriving the directory path from `request.user.sub`. There is no workspace membership model, no resource ownership table, no policy layer, and no entitlement or quota checks.
- The frontend `admin.model.ts` uses the roles `admin | operator | viewer`, which do not exist in the database (`admin | user`). The mock interceptor and the real API disagree about the role vocabulary.

The workspace, project, device, datastream, and dashboard hierarchy described in `docs/DATABASE.md` does not exist in any form.

---

## 6. Prisma and Database Access

### 6.1 Current state

- Prisma 7 with the `@prisma/adapter-pg` driver adapter and `@prisma/extension-read-replicas`. Reads route to `DATABASE_REPLICA_URL` when set; writes and transactions go to `DATABASE_URL`.
- The client is generated into `src/generated/prisma` (gitignored) and wrapped by a global `PrismaService` with a 10-attempt connect-with-backoff.
- Schema: three models only — `Role`, `User`, `Session`. Snake-case column mapping, UUID primary keys, correct foreign keys, cascade on `sessions.user_id`.
- One migration, `20260715082240_add_auth`. Seeds create the two roles and three users.

### 6.2 Findings

| # | Issue |
| --- | --- |
| D1 | **The seed file contains a real plaintext password** for `admin1@gmail.com`, `user1@gmail.com`, and `user2@gmail.com` in `prisma/seeds/user.seed.ts`. It is committed source, not a generated value |
| D2 | No repository layer; Prisma calls are spread through five services |
| D3 | `AdminUsersService.list()` is unbounded — no pagination, no limit. It also fetches a nested session per user, so the query cost grows with the user count |
| D4 | Read-replica routing is configured but no replica is deployed; the read path is untested |
| D5 | The schema covers roughly 5 % of the domain model in `docs/DATABASE.md` |
| D6 | The migration timestamp `20260715` is dated in the future relative to the first commit — the migration history is not a reliable audit trail |
| D7 | User project files live on the server filesystem (`.workspace-data/<userId>/<projectId>/`) with no database record at all, so files, permissions, and quotas cannot be queried, shared, or backed up |

---

## 7. Reusable UI and Components

`src/app/shared/components/` holds eleven components. Actual usage outside `shared/`:

| Component | Files using it | Verdict |
| --- | --- | --- |
| `CustomSelect` | 7 | Keep — genuinely shared |
| `StatusBadge` | 5 | Keep |
| `Toast` | 3 | Keep |
| `FileIcon` | 2 | Keep |
| `LineChart` | 2 | Keep |
| `MetricIcon` | 1 | Review — possibly feature-local |
| `FieldError` | 1 | Review — should be used by every reactive form |
| `DateRangePicker` | 1 | Review |
| `MetricCard` | 0 | Dead code |
| `StatCard` | 0 | Dead code |
| `month-range-filter` | 0 | **Empty directory** |

Also reusable and worth keeping: `shared/pipes/file-size.pipe.ts`, `shared/pipes/uptime.pipe.ts`, `core/services/crud.service.ts`, `core/services/logger.service.ts`, `core/guards/auth.guard.ts`, `core/interceptors/auth.interceptor.ts`.

---

## 8. Duplicated Code

| # | Duplication | Locations |
| --- | --- | --- |
| P1 | `resolveCommand()` and `buildEnvironment()` are byte-identical in two services | `workspace-build.service.ts:199-208`, `workspace-device.service.ts:275-284` |
| P2 | PlatformIO command discovery and the "PlatformIO Core is not installed" message are repeated in three places | `workspace-build.service.ts:95`, `workspace-device.service.ts:74,114` |
| P3 | The admin user `serialize()` projection (`role`, `sessions take 1`) is written twice inside one service | `admin-users.service.ts:26-38, 94-102` |
| P4 | Password complexity rules are duplicated as decorators in two DTOs | `change-password.dto.ts`, `update-admin-user.dto.ts` |
| P5 | The refresh-token lifetime is expressed three times (`'7d'`, `REFRESH_TOKEN_LIFETIME_MS`, `REFRESH_COOKIE_MAX_AGE`) across two files | `auth.service.ts:23-24`, `auth.controller.ts:28` |
| P6 | The user projection `{ id, username, email, isActive, role }` is repeated in `getMe` and `updateMe` | `auth.service.ts:205, 240` |
| P7 | The OpenRouter-backed providers (Meta, Gemma, NVIDIA) are three near-identical classes differing only in labels and model lists | `ai-provider.adapters.ts:406-506` |
| P8 | Several frontend stores repeat the same `_loading` / `_error` Signal scaffolding and `subscribe({ next, error })` block | `admin/*/**.store.ts`, `admin/profile` |
| P9 | `localStorage` read/write with try-catch is hand-rolled in five places instead of one storage service | `project.store.ts`, `project-workspace.page.ts`, `dashboard-builder.page.ts`, `ai-assistant.store.ts`, `device-preference.service.ts` |
| P10 | Thai error strings are inlined in stores rather than centralised | all admin stores |

---

## 9. Security Vulnerabilities

Ordered by severity. Severity assumes the current code deployed as-is to a multi-tenant production environment.

### S1 — Critical: user-controlled code is compiled inside the API process

`workspace-build.service.ts:104` runs `pio run --project-dir <staging>` with `execFile` **inside the NestJS API process**, on a staging directory populated from user-supplied files. If the user supplies their own `platformio.ini`, PlatformIO honours directives such as `extra_scripts`, which execute arbitrary Python at build time. This is remote code execution on the API host, as the API user, and it directly violates `docs/SECURITY.md` ("Never run user code using … shell execution inside NestJS API").

### S2 — Critical: the whole process environment is handed to the build

`workspace-build.service.ts:205-208` and `workspace-device.service.ts:281-284` pass `{ ...process.env }` to the child process. That environment contains `DATABASE_URL` (with the database password), `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `GEMINI_API_KEY`, and `OPENROUTER_API_KEY`. Combined with S1, one build request exfiltrates every secret the platform owns.

### S3 — Critical: authentication is bypassable by configuration

`workspace-access.guard.ts:19-31` — when `NODE_ENV !== 'production'` and `WORKSPACE_ALLOW_ANONYMOUS` is not explicitly `'false'`, the guard **fabricates** `request.user = { sub: 'development-user', … }` and returns `true` without any token. Both conditions default to the permissive value (`WORKSPACE_ALLOW_ANONYMOUS` defaults to `'true'` in code and in `.env.example`). Any deployment where `NODE_ENV` is unset exposes the entire Web IDE, including the build and serial endpoints, to unauthenticated callers.

### S4 — High: live API keys are present in a working-tree `.env`

`backend/.env` holds real `GEMINI_API_KEY` and `OPENROUTER_API_KEY` values plus both JWT secrets and the database URL. The file is matched by `backend/.gitignore`, so it is not currently tracked — but the backend repository has zero commits and the root repository does not track the directory at all, so that protection has never actually been exercised. **These keys should be rotated regardless, because they exist in plaintext on a developer workstation and were readable during this audit.**

### S5 — High: a real password is committed in the seed file

`prisma/seeds/user.seed.ts` seeds three accounts, including an `admin` account, with a literal plaintext password (now redacted from this document). Anyone with repository access holds admin credentials for every environment seeded from this file.

### S6 — Low (corrected from High): unsanitised markdown relies on an implicit framework control

`ai-assistant.page.html:342` binds `[innerHTML]="message.content | markdown"`, and `markdown.pipe.ts` calls `marked()` with no sanitiser. `marked` does not strip HTML, and model output is untrusted input.

**Correction, 2026-08-28:** this was first recorded as exploitable stored XSS. That was wrong. The pipe returns a plain `string`, and Angular sanitises every plain-string `[innerHTML]` binding through `DomSanitizer` automatically — only a `SafeHtml` from `bypassSecurityTrust*` skips it, and no such call exists in this codebase. The finding is therefore a defence-in-depth weakness, not a live vulnerability: the protection is real but implicit, and one future refactor to `SafeHtml` would silently remove it.

Fixed in Phase 0 by sanitising explicitly inside the pipe while still returning a plain string, so the value is sanitised on both passes and the intent is visible at the point of rendering.

### S7 — High: serial-port access is not authorised per device

`GET /api/projects/:projectId/workspace/devices` lists every serial device attached to the **server host**, and `POST serial/start` opens any of them. There is no ownership or membership check. On a shared host, one tenant reads and writes another tenant's hardware.

### S8 — Medium: no rate limiting anywhere

No `@nestjs/throttler`, no gateway limits. Login, register, availability-check, AI chat, and build endpoints all accept unlimited requests. `GET /api/auth/availability` is an unauthenticated, unthrottled username and email enumeration oracle.

### S9 — Medium: no `helmet`, no payload limit, no request timeout

`main.ts` configures only `cookie-parser`, `ValidationPipe`, and CORS. No security headers, and the default Express body limit applies rather than a considered one.

### S10 — Medium: build output is returned verbatim to the client

`workspace-build.service.ts:118` returns `${stdout}${stderr}` unfiltered. Compiler output contains absolute server filesystem paths, toolchain locations, and potentially environment values — information disclosure that `docs/SECURITY.md` prohibits for production responses.

### S11 — Medium: role changes do not take effect until token expiry

`AdminRoleGuard` trusts the `role` claim in the access token. Demoting an administrator leaves them fully privileged for up to 15 minutes. Session revocation on suspension exists, but revokes only refresh sessions — the current access token stays valid.

### S12 — Medium: the `secure` cookie flag depends on `NODE_ENV`

`auth.controller.ts:39` sets `secure: process.env.NODE_ENV === 'production'`. Any environment where `NODE_ENV` is unset transmits the refresh token over plaintext HTTP.

### S13 — Low: no CSRF defence beyond `sameSite=lax`

The refresh cookie is `sameSite=lax` and the refresh endpoint is `POST`, which blocks the common case, but there is no anti-CSRF token and no `Origin` check.

### S14 — Low: unbounded admin user listing

`GET /api/admin/users` returns every user with a nested session query. It becomes a denial-of-service vector once the user table is large.

### S15 — Low: AI system context leaks host details

`system-context.service.ts` sends the server `hostname()`, platform, CPU count, load average, and memory to whichever third-party AI provider is selected. The prompt tells the model not to reveal secrets, but a prompt instruction is not an access control.

---

## 10. Performance Problems

| # | Problem | Location |
| --- | --- | --- |
| F1 | Serial monitor output is polled every 650 ms over HTTP instead of pushed over WebSocket | `project-workspace.page.ts:1237` |
| F2 | Server monitoring re-renders on a 5 s `interval` with fully regenerated fake data | `server-monitoring.service.ts:85` |
| F3 | Builds run synchronously inside the request with a 180 s timeout — the request thread and an HTTP connection are held for up to three minutes, and there is no queue | `workspace-build.service.ts:110` |
| F4 | Build concurrency is guarded by an in-memory `Set`, which does not survive a restart and does not work across replicas | `workspace-build.service.ts:29` |
| F5 | Serial sessions live in an in-memory `Map` with 2,000 buffered lines per session, never evicted until the process exits — an unbounded memory leak across many users | `workspace-device.service.ts:51` |
| F6 | `toolchainStatus()` spawns `pio --version` on every build, every device list, and every monitor start — no caching | `workspace-build.service.ts:45` |
| F7 | Every guarded route navigation triggers `refreshAccessToken()` + `getCurrentUser()`; four guards on `/user` and `/admin` multiply the round trips | `auth.guard.ts` |
| F8 | Two components exceed 1,000 lines (`virtual-device.page.ts` 2,157; `project-workspace.page.ts` 1,501); change detection and bundle cost both suffer | — |
| F9 | The admin user list has no pagination | `admin-users.service.ts:26` |
| F10 | `listFiles()` walks the project tree and `stat()`s each entry on every call, and the build path calls `readFile()` once per file sequentially | `workspace.service.ts:36,197` |
| F11 | `frontend/dist/` holds 275 MB of build and scratch output, including a full Chrome browser profile (`chrome-sonar/`) | — |

---

## 11. Technical Debt

1. **Three nested Git repositories**, one with zero commits, no submodules, no monorepo tooling.
2. **Half the admin UI has no backend.** Database, integrations, settings, server monitoring, and system logs are simulated; the mock interceptor that once served them is disabled in both environments.
3. **Effectively no test coverage.** One backend spec file; zero frontend specs across ~45,000 lines.
4. **`AGENTS.md` describes Supabase, WebSocket, and isolated build workers. None exist.** The only occurrence of the word "Supabase" in the entire source tree is a fake service name in the monitoring mock.
5. **Two documentation trees disagree**: `docs/` at the root describes the target platform; `frontend/AGENTS.md` and `frontend/docs/architecture/` describe the legacy frontend.
6. **Mixed-language comments and strings** — Thai comments and Thai user-facing strings are inlined in TypeScript, against the English-code rule in `AGENTS.md`, with no i18n layer.
7. **No CI**, no lint gate, no type-check gate, no formatting gate.
8. **`useMockApi` is a build-time boolean**, so mock and real modes cannot coexist per feature during an incremental migration.
9. **Frontend and backend role vocabularies differ** (`admin|operator|viewer` vs `admin|user`).
10. **`.workspace-data/` and `.platformio-core/` are stateful server directories** with no lifecycle policy, quota, or cleanup.
11. **Empty and dead artefacts**: `shared/components/month-range-filter/` (empty), `MetricCard`, `StatCard`, and `docs/CONVENTION.md` (0 bytes — note that `AGENTS.md` routes to `docs/CONVENTIONS.md`, plural, which does not exist).

---

## 12. Code That Should Be Preserved

Preserve means: keep the design and the behaviour, port the implementation.

| Asset | Reason |
| --- | --- |
| `workspace.service.ts` path-safety layer | `normalizeFilePath`, `safeIdentifier`, `assertInside`, the segment allow-list, and the depth and size caps. Careful, tested defence in depth. Reuse it verbatim for Supabase Storage object keys |
| `workspace.service.spec.ts` | The only real test in the repository, and it tests the right thing (traversal refusal) |
| The AI provider adapter pattern | `AiProviderAdapter` interface + `descriptor()` + per-provider classes, with model allow-listing and keys held server-side. Port as-is into the `ai` module |
| Session lifecycle semantics | Rotation, hashing at rest, explicit revocation, revoke-others-on-password-change. Reimplement the same guarantees on Supabase Auth |
| `authInterceptor` single-flight refresh | Correct `shareReplay` + 401 retry handling; keep it even after moving to Supabase sessions |
| `CrudService` / `CrudResource` | Clean, typed, and correctly scoped to standard CRUD only |
| Angular routing and lazy-loading structure | Already matches the target conventions |
| Shared components in active use | `CustomSelect`, `StatusBadge`, `Toast`, `FileIcon`, `LineChart` |
| Virtual device simulator | ~6,000 lines of domain-specific circuit and device modelling; irreplaceable and independent of the backend |
| Dashboard builder canvas and widget model | Substantial UI work; only its persistence layer needs replacing |
| Monaco editor integration | A working Web IDE editor with tab and cursor state |
| DTO validation discipline | `class-validator` usage is consistently thorough, especially in the workspace DTOs |

---

## 13. Code That Should Be Refactored

Keep the module, change its internals.

| Target | Change |
| --- | --- |
| All backend services | Introduce a repository layer; no `prisma.db.*` or Supabase client calls outside repositories |
| `auth.service.ts` (317 lines) | Split into `AuthService` (orchestration), `SessionService` (lifecycle), and `ProfileService` (me / update / password). Extract lifetimes and bcrypt cost into one config object |
| `workspace-build.service.ts` + `workspace-device.service.ts` | Extract a shared `PlatformIoService` for command resolution, environment construction, and toolchain probing with caching (fixes P1, P2, F6) |
| `ai-provider.adapters.ts` (506 lines) | Collapse Meta / Gemma / NVIDIA into one parameterised `OpenRouterProvider` (fixes P7) |
| `admin-users.service.ts` | Add pagination; extract the projection constant; move the password policy into a shared validator |
| `project-workspace.page.ts` (1,501 lines) | Split into file-explorer, editor-host, build-panel, serial-panel, and AI-panel components plus a `WorkspaceStore` |
| `virtual-device.page.ts` (2,157 lines) | Split into canvas, palette, inspector, and simulation-host components |
| The remaining admin stores | Extract a generic `createAsyncStore()` or base signal-store helper (fixes P8) |
| The five `localStorage` call sites | One injectable `BrowserStorageService` (fixes P9) |
| `markdown.pipe.ts` | Sanitise `marked` output through DOMPurify or Angular's sanitiser before binding (fixes S6) |
| Thai UI strings | Move into an i18n resource layer; keep code English-only |
| `main.ts` | Add `helmet`, the versioned prefix `api/v1`, payload limits, a global exception filter, and structured logging |

---

## 14. Code That Should Eventually Be Replaced

| Target | Replaced by | Note |
| --- | --- | --- |
| Custom JWT + `users.password` + `sessions` table | Supabase Auth | Removes A1, A2, A4, A5, A6, A7, and A9 in one step; adds email verification, reset, and MFA |
| `workspace-build.service.ts` in-process `execFile` | Build queue + isolated ephemeral worker (container, non-root, CPU/RAM/timeout/network limited) | Fixes S1, S2, F3, F4. Non-negotiable before any public deployment |
| `workspace-access.guard.ts` anonymous bypass | A standard `SupabaseAuthGuard` with no development escape hatch | Fixes S3 |
| Filesystem project storage (`.workspace-data/`) | A `project_files` table + Supabase Storage objects | Fixes D7; enables sharing, quotas, versioning, and backup |
| `mock-api.interceptor.ts` (400 lines) | Real endpoints, module by module | Delete each fixture as its backend lands |
| `server-monitoring.service.ts` simulation | A real metrics endpoint or an observability provider | Currently 353 lines of random-number generation presented as production telemetry |
| `project.store.ts` `localStorage` + `MOCK_PROJECTS` | A `projects` API backed by PostgreSQL | |
| `dashboard-builder` `localStorage` persistence | `dashboards` / `dashboard_widgets` tables | |
| Serial-output HTTP polling | A WebSocket gateway | Fixes F1 |
| The single `role_id` column | An explicit `workspace_members` table with a role per workspace, plus a policy layer and RLS | Enables everything in section 5 that is currently absent |
| `frontend/dist/` (275 MB, includes a Chrome profile) | Clean, gitignored build output | |
| `prisma/seeds/user.seed.ts` hardcoded password | Environment-supplied or generated seed credentials | Fixes S5 |

---

## 15. Immediate Actions Independent of the Migration

These do not depend on any architectural decision and should not wait for one.

1. **Rotate `GEMINI_API_KEY` and `OPENROUTER_API_KEY`** (S4).
2. **Change the previously hardcoded seed password everywhere it was seeded, and remove it from the seed source** (S5).
3. **Set `WORKSPACE_ALLOW_ANONYMOUS=false` and `NODE_ENV` explicitly in every environment** (S3, S12).
4. **Stop exposing the build endpoint**, or restrict it to trusted accounts, until an isolated worker exists (S1, S2).
5. **Sanitise the markdown pipe output** (S6).
6. **Resolve the nested Git repositories** before starting migration branches.

---

## 16. Open Questions

Recorded rather than guessed. Each is a decision the migration plan in `docs/ARCHITECTURE.md` depends on.

| # | Question | Options |
| --- | --- | --- |
| Q1 | Database access layer | (a) Supabase server SDK — natural RLS fit, weaker typing for complex queries; (b) Prisma 7, backend-only — already working and strongly typed, but a second schema source of truth and awkward alongside RLS; (c) Kysely or a raw `pg` query builder — full SQL control, most work. Record the outcome in `docs/adr/ADR-001-database-access.md` |
| Q2 | Existing user migration | (a) Import `users` into Supabase Auth and force a password reset; (b) dual-run both auth systems during a transition window; (c) treat the three seeded accounts as disposable and start clean. The existing data set is a seed, so (c) is cheapest if no real users exist |
| Q3 | Build worker isolation | (a) A Docker container per build; (b) Firecracker or gVisor microVM; (c) a managed CI runner. Depends on the deployment target, which is not yet documented |
| Q4 | Repository layout | (a) One monorepo (Nx or npm workspaces) at `iot-hub/`; (b) two independent repositories with the shared `docs/` in one of them; (c) keep the current nested layout — not viable |
| Q5 | Telemetry storage | (a) PostgreSQL with a `(device_id, timestamp)` index initially, as `docs/DATABASE.md` suggests; (b) TimescaleDB from the start; (c) an external time-series store. Depends on expected ingest volume, which is unknown |
| Q6 | Whether Supabase Realtime replaces the planned NestJS WebSocket gateway | (a) Supabase Realtime for database-change events plus a NestJS gateway for device and build events; (b) a NestJS gateway only, for one contract; (c) Supabase Realtime only — does not cover build status or serial streaming well |
| Q7 | Hosting model | Supabase Cloud versus self-hosted Supabase. Affects RLS operations, connection pooling (PgBouncer transaction mode breaks prepared statements), and where the build workers run |

---

# Remediation Status

Updated 2026-08-28, after Phases 0 and 1.

| Finding | Status |
| --- | --- |
| S1 in-process build of user code | **Fixed** — implementation deleted, endpoint returns 503, regression test added |
| S2 full `process.env` to build child | **Fixed** — no process-spawning code remains in the workspace module |
| S3 anonymous auth bypass | **Fixed** — guard deleted, routes use `JwtAuthGuard` |
| S4 live API keys in local `.env` | **Requires manual rotation** — see `docs/SECURITY.md` |
| S5 password literal in seed source | **Fixed in source** — seeds are environment-driven or generated. **Live accounts still require a manual password change** |
| S6 unsanitised markdown | **Fixed** — sanitised explicitly; severity also corrected, see the entry above |
| S7 unauthorised serial/device access | **Fixed** — host device and serial endpoints disabled |
| S8 no rate limiting | **Fixed** — global tier plus stricter auth, AI, and build tiers |
| S9 no Helmet, no payload limit | **Fixed** |
| S10 raw build output returned | **Fixed** — no build output is produced |
| S11 role trusted from JWT claim | **Open** — Phase 3 |
| S12 `secure` cookie keyed off `NODE_ENV` | **Fixed** — fails closed, explicit opt-out for local HTTP only |
| S13 no anti-CSRF token | **Open** — Phase 3 |
| S14 unpaginated admin user list | **Open** — Phase 7 |
| S15 AI context leaks host identity | **Fixed** — `hostname()` and `platform()` removed |
| A3 Turnstile never verified | **Open** — decision in ADR-003 |
| A5 unique index on a bcrypt hash | **Open** — Phase 2 migration |
| A6 sessions never purged | **Open** — Phase 2 |
| A7 bcrypt cost duplicated in four places | **Fixed** — one constant, raised from 10 to 12 |
| A8 access token lifetime declared twice | **Fixed** — one constant |
| P1–P6 backend duplication | **Fixed** (P1, P2 by deletion; P3, P5, P6 by extraction) |
| P7 duplicated OpenRouter providers | **Open** — cosmetic |
| P8, P9 frontend duplication | **Open** — deferred, see `docs/ARCHITECTURE.md` |
| D2 no repository layer | **Fixed** — Phase 1 |
| F3, F4, F5, F6 build/serial performance | **Fixed by deletion**; returns as a queued job in Phase 4 |
| F11 275 MB in `frontend/dist/` | **Open** — gitignored, safe to delete manually |

## Correction to the repository shape section

The backend repository now has three commits: a baseline import, Phase 0, and
Phase 1. The plaintext seed password was removed **before** the baseline commit, so
it never entered Git history.

The frontend repository still holds a large uncommitted working tree, so the three
repositories were **not** consolidated. Doing so safely requires that work to be
committed first. See `docs/SECURITY.md` and the final report for the manual steps.
