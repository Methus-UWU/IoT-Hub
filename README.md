# IoT Hub

All-in-one IoT platform: project workspace, AI-assisted code generation, firmware
builds, devices, telemetry, dashboards, and community.

| Path | What it is |
| --- | --- |
| `frontend/` | Angular frontend (standalone components, Signals). Served on `http://localhost:4200` in development. |
| `backend/` | NestJS API with Prisma. Served on `http://localhost:3000/api`. |
| `build-worker/` | Isolated firmware build workers (PlatformIO builder image + dispatcher). Optional. |
| `docs/` | Architecture, security, database, API, conventions, ADRs, deployment. |
| `deploy/`, `Dockerfile`, `compose.yaml` | Production containers. |
| `scripts/` | Root build and production verification scripts. |
| `AGENTS.md` | Rules for contributors and AI coding agents. Read it before changing code. |

## How it works

IoT Hub takes a maker from an idea to a working device in one browser tab:

```
Create project → Design circuit → Write code (or ask AI) → Simulate → Compile → Flash board → Send telemetry → Dashboard
```

- **Projects.** A project belongs to a workspace and has one board (ESP32 DevKit or
  Arduino Uno), its peripherals, the wiring between them, and its source files. All
  of it is stored in Supabase PostgreSQL.
- **Circuit canvas and simulator.** The Virtual Device page places parts on a
  breadboard-style canvas at real physical scale, checks the wiring, and runs the
  sketch in a browser simulator.
- **Web IDE.** A Monaco editor with autosave and version checks, so a stale tab
  cannot overwrite newer work. Libraries install from the PlatformIO Registry.
- **Project AI assistant.** Reads the project's real board, parts, wiring, and files
  on the server, proposes code and wiring as a plan, and changes nothing until the
  user accepts it. A separate IoT advisor answers general questions and explains
  compiler errors.
- **Firmware builds.** The API queues a build; an isolated Docker container with
  PlatformIO and no network compiles it. The browser downloads the image and flashes
  the board over Web Serial, then opens the serial monitor.
- **Devices and dashboards.** A provisioned device sends readings with its own token
  to `/api/device/v1/telemetry`. Dashboards show the values and history, and their
  controls send values back to the device.
- **Community and documents.** Q&A posts with votes and accepted answers, plus Thai
  guides and device datasheets.

The Angular app talks only to the NestJS API, except for sign-in, which goes straight
to Supabase Auth. The API checks the Supabase token, reads the user's role and
workspace membership from the database on every request, and never runs user code.
Diagrams and module layout: `docs/ARCHITECTURE.md` § "System Overview".

## Usage

After the steps below, sign up at `http://localhost:4200`, then:

1. **Projects → New project.** Choose a board (for example ESP32 DevKit V1), a
   framework (Arduino C++ or PlatformIO), and peripherals such as a DHT22 and an LED.
2. **IDE.** Open the AI panel and ask
   *"wire the DHT22 and print temperature every 2 seconds"*. Review the proposed
   wiring and code, then accept the plan. Or edit `main.ino` yourself.
3. **Virtual Device.** Check or adjust the wiring on the canvas and run the sketch
   in the simulator.
4. **Compile and upload.** In the IDE, **Compile** queues a build. With a board on
   USB, **Upload** compiles, flashes over Web Serial, and opens the Serial Monitor
   (Chrome or Edge).
5. **Dashboard.** Add a device to get its token (shown once, with a sample sketch),
   add widgets bound to datastreams, and have the board send readings (example in
   `docs/API.md` § "Usage examples").
6. **Assistant.** Ask the IoT advisor general questions, or paste a compiler error
   for analysis.

Check the API from a terminal:

```sh
curl http://localhost:3000/api/health
# {"data":{"status":"ok"}}
```

## Prerequisites

- **Node.js 24** and npm (the Docker images use Node 24).
- A **Supabase** project (PostgreSQL, Auth, Storage). The platform has no local
  database container; it runs against Supabase.
- An **OpenRouter** API key for the AI features. A Gemini API key is optional.
- **Docker** — only for firmware builds and production deployment.

## 1. Set up Supabase

1. Create a project at <https://supabase.com>.
2. Collect these values:
   - **Project URL** and **publishable key** — Project Settings > API.
   - **Secret key** (`sb_secret_...`) — Project Settings > API. Backend only; it
     bypasses RLS and must never reach the frontend or Git.
   - **Database connection string** — Connect > **Session pooler** (port `5432`).
     The transaction pooler on port `6543` cannot run Prisma migrations.
3. Authentication > URL Configuration:
   - Site URL: `http://localhost:4200`
   - Redirect URLs: add `http://localhost:4200/auth/callback`
4. Optional: enable Google or GitHub under Authentication > Providers. Email and
   password sign-in works without extra setup.

## 2. Run the backend

```sh
cd backend
npm ci
cp .env.example .env
```

Fill in `backend/.env`:

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | Session pooler connection string from step 1 |
| `SUPABASE_URL` | yes | Project URL |
| `SUPABASE_SECRET_KEY` | yes | Secret key |
| `OPENROUTER_API_KEY` | yes, for AI | OpenRouter key |
| `CORS_ORIGINS` | yes | `http://localhost:4200` (comma-separated for more origins) |
| `GEMINI_API_KEY` | no | Enables Gemini for the IoT advisor |

Every other variable in `.env.example` is optional and documented there; the full
list is in `docs/CONFIGURATION.md`. Without
the Supabase values, authenticated routes answer `503 AUTH_NOT_CONFIGURED`.

Generate the Prisma client and apply the migrations, then start the API:

```sh
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
```

Check `http://localhost:3000/api/health`.

> Prisma Migrate is the only schema source (`backend/prisma/`). Do not author
> `public` schema changes with the Supabase CLI or dashboard. The migrations also
> create the RLS policies, the sign-up trigger on `auth.users`, and the `admin` and
> `user` roles. See `docs/DATABASE.md`.

## 3. Run the frontend

```sh
cd frontend
npm ci
```

Point the app at your Supabase project. Edit both files and fill in `supabaseUrl`
and `supabasePublishableKey` with your values (publishable key only, never the
secret key):

- `frontend/src/environments/environment.development.ts` — used by `npm start`
- `frontend/src/environments/environment.ts` — used by production builds

```sh
npm start
```

Open `http://localhost:4200`.

The Playwright specs read the Supabase session from local storage under
`sb-<project-ref>-auth-token`. Replace the project ref in
`frontend/e2e/support/auth-session.ts` and `frontend/e2e/account-settings.spec.ts`
with your own before running `npm run test:e2e`.

## 4. Create the first admin

Sign up through the app. The database trigger creates your profile and a personal
workspace. Then grant the admin role in the Supabase SQL editor:

```sql
UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'admin')
WHERE email = '<your address>';
```

Sign out and back in.

## 5. Firmware builds (optional)

Builds are off until `BUILD_WORKER_TOKEN` (at least 32 characters) is set. The API
never compiles user code; builds run in isolated Docker containers started by the
dispatcher in `build-worker/`. The builder image is about 2.2 GB.

Setup, security constraints, and commands: `docs/DEPLOYMENT.md` § "Firmware builds",
`build-worker/README.md`, and `docs/adr/ADR-002-build-isolation.md`.

## Tests and builds

From the repository root, after `npm ci` in both sub-projects:

```sh
npm test            # backend unit + e2e, then frontend checks
npm run build       # prisma generate, nest build, ng build, verify outputs
```

Per project: `npm test`, `npm run lint` in `backend/`; `npm test`,
`npm run test:e2e` (Playwright) in `frontend/`.

## Production

`compose.yaml` builds the API (`nestjs`) and the static frontend (`nginx`) images and
optionally the build dispatcher. It currently targets the original deployment: the
domain `unity-hub.connectdb.xyz` and an external Docker network named `web`. Change
`CORS_ORIGINS`, `FRONTEND_URL`, the network, and the Supabase Auth URLs for your own
host. Full guide: `docs/DEPLOYMENT.md`.

## Documentation

Start with `AGENTS.md`, then read only what the change needs:

| Topic | File |
| --- | --- |
| Architecture, diagram, tech stack, folders | `docs/ARCHITECTURE.md` |
| Auth, RLS, secrets, user code | `docs/SECURITY.md` |
| Schema, migrations, repositories | `docs/DATABASE.md` |
| ER diagram | `docs/diagrams/iot-hub-erd.png` (interactive: `iot-hub-erd.html`) |
| Naming, folders, reuse rules | `docs/CONVENTIONS.md` |
| REST, DTOs, WebSocket events, examples | `docs/API.md` |
| Environment variables, dependencies, deployment steps | `docs/CONFIGURATION.md` |
| Production deployment details | `docs/DEPLOYMENT.md` |
| Known issues and future plans | `docs/KNOWN_ISSUES.md` |
| Decisions | `docs/adr/` |
| Work items (pages, AI generator, refactors) | `docs/agent/README.md` |

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `prisma migrate` hangs or fails with prepared-statement errors | `DATABASE_URL` uses the transaction pooler (`6543`). Use the session pooler (`5432`). |
| `Cannot find module '.../generated/prisma/...'` | Run `npm run prisma:generate` in `backend/`. |
| API returns `503 AUTH_NOT_CONFIGURED` | `SUPABASE_URL` or `SUPABASE_SECRET_KEY` is missing. |
| Browser blocks API calls with a CORS error | Add the frontend origin to `CORS_ORIGINS`. |
| Sign-in redirects to the wrong host | Fix Site URL and Redirect URLs in Supabase Auth. |
| Build button does nothing / builds disabled | `BUILD_WORKER_TOKEN` is unset or shorter than 32 characters. |

## Secrets

Never commit or share `.env` files, the Supabase secret key, database passwords, AI
keys, or `BUILD_WORKER_TOKEN`. Each developer uses their own `.env` copied from
`.env.example`.
