# Setup and Configuration

Updated 2026-10-18.

This guide lists what the platform needs to run: dependencies, every environment
variable, and the order of deployment steps. Step-by-step local setup is in
`README.md`; production details and verification are in `docs/DEPLOYMENT.md`.

Never commit `.env` files. Real values for the secrets below belong only in each
environment's own `.env` or secret store.

## Dependencies

### Tools

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js and npm | 24 | Backend, frontend, build dispatcher (the Docker images use Node 24) |
| Supabase project | Cloud | PostgreSQL, Auth, Storage. There is no local database container |
| OpenRouter API key | — | AI features (project assistant, admin assistant, advisor fallback) |
| Gemini API key | — | Optional. The IoT advisor uses Gemini first when set |
| Docker | Compose v2.20+ (v2.24.4+ for the smoke override) | Firmware builds and production deployment only |

### Main packages

| Project | Package | Purpose |
| --- | --- | --- |
| `backend` | `@nestjs/*` 11 | HTTP framework, DI, config, rate limiting (`@nestjs/throttler`) |
| `backend` | `prisma`, `@prisma/client` 7, `@prisma/adapter-pg`, `@prisma/extension-read-replicas` | Schema migrations and repository implementations |
| `backend` | `@supabase/supabase-js`, `jose` | Supabase admin operations and JWT verification against the project JWKS |
| `backend` | `class-validator`, `class-transformer` | DTO validation |
| `backend` | `helmet` | Security headers |
| `frontend` | `@angular/*` 22 | Standalone components, Signals, router |
| `frontend` | `@supabase/supabase-js` | Sign-up, sign-in, OAuth, session refresh in the browser |
| `frontend` | `monaco-editor` | IDE code editor |
| `frontend` | `esptool-js` | Flashing ESP32 boards over Web Serial |
| `frontend` | `marked` | Markdown rendering (sanitized) |
| `frontend` | `tailwindcss` 4 | Styling |
| `build-worker/dispatcher` | none | Uses Node built-ins only |
| `build-worker/builder` | PlatformIO image (~2.2 GB) | Compiles firmware with no network access |

Install with `npm ci` in `backend/` and `frontend/`. The dispatcher has no
dependencies to install.

## Environment variables

### Backend — `backend/.env`

Copy `backend/.env.example` to `.env`. The example file documents each value inline.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Supabase **session pooler** connection string (port `5432`). The transaction pooler (`6543`) cannot run Prisma migrations |
| `DATABASE_REPLICA_URL` | no | primary | Read replica for read-only queries |
| `SUPABASE_URL` | yes | — | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | yes | — | **Secret.** Bypasses RLS. Backend only. `SUPABASE_SERVICE_ROLE_KEY` is accepted as a legacy alias |
| `SUPABASE_PUBLISHABLE_KEY` | no | — | Browser-safe key. Logged as missing if unset. `SUPABASE_ANON_KEY` is accepted as a legacy alias |
| `CORS_ORIGINS` | yes | — | Allowed browser origins, comma-separated. With no origins configured, production serves no browser origin (fails closed) |
| `FRONTEND_URL` | no | — | Single-origin fallback when `CORS_ORIGINS` is unset |
| `TRUST_PROXY` | no | empty | Express `trust proxy`. Set `loopback, uniquelocal` behind nginx; leave empty when clients reach the API directly |
| `NODE_ENV` | production: yes | — | Must be `production` in production; several controls read it |
| `PORT` | no | `3000` | API listen port |
| `WORKSPACE_ROOT` | no | `.workspace-data` | Used only by the deprecated workspace file routes |
| `BUILD_WORKER_TOKEN` | no | unset | **Secret.** At least 32 characters. Shared with the build dispatcher. Unset keeps firmware builds off |
| `OPENROUTER_API_KEY` | for AI | — | **Secret.** OpenRouter key |
| `OPENROUTER_BASE_URL` | no | `https://openrouter.ai/api/v1` | OpenRouter endpoint |
| `AI_CATALOG_TTL_MS` | no | `3600000` | How long the fetched model catalog is reused |
| `AI_ALLOW_PAID_MODELS` | no | `false` | Paid models enter the ranking only when exactly `true` |
| `AI_PROJECT_MODEL` | no | ranked | Comma-separated pinned models for the project assistant, tried first |
| `AI_PROVIDER_SORT` | no | `latency` | OpenRouter host ordering: `latency`, `price`, or `throughput` |
| `AI_MAX_OUTPUT_TOKENS` | no | `1600` | Output ceiling per reply |
| `AI_MODELS_PER_VENDOR` | no | `8` | Models per vendor returned by the model picker |
| `AI_FALLBACK_MODEL` | no | `meta-llama/llama-3.3-70b-instruct:free` | Used only when the catalog is unreachable and the cache is cold |
| `GEMINI_API_KEY` | no | unset | **Secret.** Enables Gemini for the IoT advisor |
| `GEMINI_MODEL` | no | `gemini-flash-lite-latest` | Gemini model |
| `GEMINI_MAX_OUTPUT_TOKENS` | no | `8192` | Gemini output budget (includes thinking) |
| `GEMINI_BASE_URL` | no | Google OpenAI-compatible endpoint | Gemini endpoint |

Without `SUPABASE_URL` and `SUPABASE_SECRET_KEY` the API still starts, logs which keys
are missing, and answers every authenticated route with `503 AUTH_NOT_CONFIGURED`.

### Frontend — `frontend/src/environments/`

The frontend has no `.env`. Edit both files:

| File | Used by |
| --- | --- |
| `environment.development.ts` | `npm start` |
| `environment.ts` | Production builds |

| Key | Value |
| --- | --- |
| `apiUrl` | API base. Production uses `/api/` behind nginx |
| `supabaseUrl` | Supabase project URL |
| `supabasePublishableKey` | Publishable key only. **Never** the secret key |

### Build dispatcher — `build-worker/dispatcher`

The dispatcher holds the Docker socket, so it receives only the worker token. It must
never be given `DATABASE_URL`, a Supabase key, or an AI key.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `BUILD_API_URL` | yes | — | API base including `/api`, e.g. `http://nestjs:3000/api` |
| `BUILD_WORKER_TOKEN` | yes | — | Same value as the backend; at least 32 characters |
| `BUILDER_IMAGE` | no | `unity-hub-builder:production` | Builder image |
| `BUILD_CONCURRENCY` | no | `1` | Parallel builds, 1–8 |
| `BUILD_POLL_INTERVAL_MS` | no | `3000` | Job polling interval |
| `BUILD_TIMEOUT_MS` | no | `300000` | Per-build timeout, 30 s–9 min |
| `BUILD_MEMORY` | no | `1536m` | Container memory limit |
| `BUILD_CPUS` | no | `1` | Container CPU limit |
| `BUILD_PIDS_LIMIT` | no | `256` | Container process limit |
| `BUILD_WORKSPACE_SIZE` | no | `768m` | Workspace tmpfs size |
| `BUILD_TMP_SIZE` | no | `512m` | `/tmp` tmpfs size |

### Docker Compose — root `.env`

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKEND_ENV_FILE` | `./backend/.env` | Runtime environment file for the API container |
| `IMAGE_TAG` | `production` | Image tag; use a unique release tag to keep a rollback image |
| `BUILD_WORKER_TOKEN` | — | Passed to both the API and the dispatcher |
| `BUILD_CONCURRENCY` | `1` | Passed to the dispatcher |
| `WORKSPACE_DATA_PATH` | `./backend/.workspace-data` | Bind mount for the deprecated workspace routes |

Compose overrides `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `FRONTEND_URL`, `TRUST_PROXY`,
and `WORKSPACE_ROOT` with production values. `CORS_ORIGINS` and `FRONTEND_URL` are
hard-coded to the original domain; change them for another host.

## Supabase settings

| Where | Setting |
| --- | --- |
| Authentication > URL Configuration | Site URL = app origin; Redirect URLs include `<app-origin>/auth/callback` |
| Authentication > Providers | Optional Google and GitHub, callback `https://<project-ref>.supabase.co/auth/v1/callback` |
| Authentication > Attack Protection | Enable CAPTCHA |
| Database | Schema changes only through Prisma Migrate (`backend/prisma/`). Never through the dashboard or Supabase CLI |

## Deployment steps

Summary. Full commands, smoke verification, and rollback are in `docs/DEPLOYMENT.md`.

1. **Prepare configuration.** Create `backend/.env` with the production values
   above. Set Supabase Auth URLs for the production domain. Put the frontend
   `supabaseUrl` and publishable key in `environment.ts`.
2. **Apply migrations.** From `backend/`, run `npm run prisma:deploy` against the
   production `DATABASE_URL`. Migrations never run automatically on deploy.
3. **Validate and build.** From the repository root:

   ```sh
   docker compose config --quiet
   docker compose build
   ```

   `config --quiet` validates without printing secrets. `npm run build` builds and
   verifies both sub-projects without Docker.
4. **Start.**

   ```sh
   docker compose up -d --no-build --wait --wait-timeout 120
   docker compose ps
   ```

   The default stack is the API (`nestjs`) and the static frontend (`nginx`).
   Firmware builds use the Compose profiles `builder-image` (the ~2.2 GB builder,
   built once) and `builds` (the dispatcher, which requires `BUILD_WORKER_TOKEN`).
   See `docs/DEPLOYMENT.md` § "Firmware builds".
5. **Verify.** Optionally run the smoke stack first (`docs/DEPLOYMENT.md` § "Smoke
   verification"). After deploying, check `/`, `/docs`, and `/api/health` (returns
   `{ "data": { "status": "ok" } }`) through the public origin, then sign in with a
   real account.
6. **First admin.** Sign up through the app, then grant the `admin` role in the
   Supabase SQL editor (`README.md` § 4).
7. **Rollback.** Tag the previous images with a release identifier before reusing
   `production`. To roll back, set `IMAGE_TAG` to that identifier and run
   `docker compose up -d --no-build --wait --wait-timeout 120`. Image rollback does
   not reverse database migrations; review schema compatibility first.
