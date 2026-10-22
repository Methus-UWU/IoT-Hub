# Production deployment

Public origin: `https://unity-hub.connectdb.xyz`.

Traffic flows through the existing Cloudflare Tunnel, `caddy:80`,
`unity-hub-nginx:80`, and finally `nestjs:3000` for `/api` requests.
`C:/Code/docker-container/edge-gateway` owns the tunnel and the external `web`
network. This application publishes no host ports.

## Build and runtime

- `Dockerfile` has separate `backend-production` and `frontend-production`
  targets. Both build on Node 24 and install from committed lockfiles with
  `npm ci`. Build dependencies never enter the final API image.
- NestJS runs `node dist/src/main.js` with `NODE_ENV=production`, without watch
  mode, installation, generation, or compilation at startup. Shutdown hooks
  close database connections when Docker stops the process.
- Angular builds with the production configuration and runs as static files in
  Nginx. Its production `apiUrl` is `/api/`, so the browser uses the same origin.
- Both containers run as non-root with read-only root filesystems, limited
  resources, rotating logs, and restart policies. Writable paths are temporary
  files and the backend workspace data mount.
- `/api/health` is a public, unthrottled process-liveness endpoint. Nest startup
  first waits for the database connection. This endpoint does not continuously
  test database availability or return configuration. `/healthz` checks Nginx.
- Compose waits for API health before starting Nginx. An `unhealthy` status alone
  does not trigger Docker's restart policy; that policy restarts exited processes.
- Nginx resolves the API container through Docker DNS again after replacement,
  supports HTTP upgrades under `/api`, and allows up to 240 seconds for API
  responses. Cloudflare's own request timeout still applies.
- Hashed assets are immutable-cacheable. HTML and SPA entry points are not cached,
  and missing assets return 404 instead of an HTML response.

## Configuration

Docker Compose v2.20+ is needed for the deployment wrapper's `include` support;
v2.24.4+ is needed for the optional smoke override's `!override` tag.

The runtime environment file defaults to `backend/.env`; it never enters the
Docker build context or image. It needs the existing `DATABASE_URL`,
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `OPENROUTER_API_KEY`. The database URL
must be reachable from the container; `localhost` means the container itself.
`DATABASE_REPLICA_URL` is optional. No database container is added.
`GEMINI_API_KEY` is optional; when set, the IoT advisor answers through Gemini and
falls back to OpenRouter.

Compose overrides `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `FRONTEND_URL`,
`TRUST_PROXY`, and `WORKSPACE_ROOT` with the production values. `TRUST_PROXY` is
Express's `trust proxy` setting; Compose sets `loopback, uniquelocal` because nginx
and the gateway reach the API over private Docker networks. Without it every
request appears to come from nginx, so sign-in history records the proxy address
and throttling counts all users as one client. Leave it unset when clients reach
the API directly, or a client could choose its own recorded address. Other environments can supply
`BACKEND_ENV_FILE` and `WORKSPACE_DATA_PATH` to Compose. `IMAGE_TAG` defaults to
`production`; use a unique release tag to retain a rollback image.

The default data bind mount preserves the existing directory
`C:/Code/website/iot-hub/backend/.workspace-data`. On a Linux host, create the
directory and grant the image's Node user (UID 1000) write access first. Back up
this directory separately from Supabase before deployment.

Frontend Supabase settings come from
`frontend/src/environments/environment.ts`. Only the publishable key belongs
there. In Supabase Auth URL Configuration, verify:

- Site URL: `https://unity-hub.connectdb.xyz`
- Redirect URL: `https://unity-hub.connectdb.xyz/auth/callback`

No schema migrations or seeds execute automatically. Apply reviewed pending
migrations through the existing database workflow before deploying code that
requires them. The production API image contains no PlatformIO toolchain:
firmware builds run in separate containers (next section).

## Firmware builds

Builds are off until `BUILD_WORKER_TOKEN` is set; the API then accepts builds and
the `build-dispatcher` service runs them. Both read the one variable from the
shell or from a root `.env` beside `compose.yaml` (Compose interpolation), so the
token lives in one place and never in `backend/.env`:

```powershell
Set-Location C:/Code/website/iot-hub
# Once: a 64-character token from the OS CSPRNG in the root .env (not committed).
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
"BUILD_WORKER_TOKEN=$(-join ($bytes | ForEach-Object { '{0:x2}' -f $_ }))" | Add-Content .env
docker compose --profile builder-image build build-builder
docker compose --profile builds build build-dispatcher
docker compose --profile builds up -d --no-build --wait --wait-timeout 120
```

- Apply migration `20261002000000_build_jobs` first.
- The builder image is about 2.2 GB and takes a while the first time: every
  platform, toolchain, framework, and catalog library is downloaded at image build,
  because a build runs with `--network=none`. Adding a board or library means
  editing `build-worker/builder/targets.json` or `libraries.json` and rebuilding it.
- The dispatcher mounts `/var/run/docker.sock`. That is root-equivalent on the host,
  which is why it is given no other secret and runs no user code. Do not add
  `DATABASE_URL`, `SUPABASE_SECRET_KEY`, or AI keys to it.
- Per-build limits come from `BUILD_MEMORY`, `BUILD_CPUS`, `BUILD_TIMEOUT_MS`,
  `BUILD_PIDS_LIMIT`, `BUILD_WORKSPACE_SIZE`, `BUILD_TMP_SIZE`, and parallelism
  from `BUILD_CONCURRENCY` (default 1); see `build-worker/dispatcher/src/config.ts`.
- Leftover containers, if the dispatcher dies mid-build, carry the label
  `iot-hub.build=true` and exit on their own timeout:
  `docker ps --filter label=iot-hub.build=true`.
- nginx answers 404 for `/api/internal/`; the dispatcher reaches the API over the
  private `internal` network.

## Build and deploy from the repository

Run in PowerShell:

```powershell
Set-Location C:/Code/website/iot-hub
docker compose config --quiet
docker compose build
docker compose up -d --no-build --wait --wait-timeout 120
docker compose ps
```

`config --quiet` validates without printing resolved secrets. Do not share the
output of a plain `docker compose config` or full `docker inspect`.

The existing Caddy route already matches this deployment:

```caddyfile
http://unity-hub.connectdb.xyz {
    reverse_proxy unity-hub-nginx:80
}
```

Keep the existing tunnel's hostname service pointing to `http://caddy:80`.
No Caddy reload is required when this route already exists.

## Keep the existing deployment directory

Back up `C:/Code/docker-container/unity-hub-website/docker-compose.yml` and replace
it with `deploy/docker-compose.gateway.yml`. This small wrapper includes the
repository's `compose.yaml`, so there is only one production definition to maintain.
Included build contexts, env files, and data paths resolve relative to the repository.

Then the same commands work from the familiar directory:

```powershell
Set-Location C:/Code/docker-container/unity-hub-website
docker compose build
docker compose up -d --no-build --wait --wait-timeout 120
docker compose ps
```

The project and container names match the old stack. Compose replaces only these
application containers. Keep old configuration, images, and data until the new
release is verified. `edge-gateway` stays separate.

## Smoke verification without changing the public route

```powershell
Set-Location C:/Code/website/iot-hub
docker compose -p unity-hub-smoke -f compose.yaml -f deploy/compose.smoke.yaml up -d --no-build --wait --wait-timeout 120
docker exec unity-hub-web-smoke nginx -t
docker exec unity-hub-web-smoke wget -qO- http://127.0.0.1/api/health
Get-Content -Raw scripts/verify-production.mjs | docker exec -i unity-hub-api-smoke node --input-type=module
docker compose -p unity-hub-smoke -f compose.yaml -f deploy/compose.smoke.yaml down -v
```

The smoke stack gets a separate ingress network and a disposable workspace volume;
Caddy cannot route to it. It uses the configured backend environment and database,
so use read-only probes. The final command removes only this smoke stack and its
disposable volume.

After deployment, check `/`, `/docs`, and `/api/health` through the public origin,
then verify login with a real account. Confirm restart counts remain zero and
both containers report healthy. Authentication is required for `/api/auth/me`.

## Updates and rollback

Build the next images before replacing running containers. Tag the previous API
and web images with a release identifier before reusing the `production` tag.
To roll back, set `IMAGE_TAG` to that saved identifier and run
`docker compose up -d --no-build --wait --wait-timeout 120`. Rollback of images
does not reverse database migrations; schema compatibility must be reviewed.

Base images are pinned by digest in `Dockerfile` for repeatable releases. Update
those digests deliberately for security releases and rebuild both images, or pass
reviewed `NODE_IMAGE` and `NGINX_IMAGE` values as Docker build arguments.

References: [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/),
[Compose readiness](https://docs.docker.com/compose/how-tos/startup-order/),
[Nginx dynamic DNS](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#resolve),
[Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Verified deployment — 2026-09-27

- Both production Docker targets built successfully; Nginx configuration validation
  also runs during the image build.
- Backend HTTP smoke tests passed (2 tests), including unthrottled health probes.
- The isolated smoke stack passed `scripts/verify-production.mjs` and was removed.
- The same checks passed through `https://unity-hub.connectdb.xyz` after cutover:
  a read-only database query, SPA deep links, hashed asset caching, missing-file
  rejection, API forwarding, CORS, and rejection of unauthenticated account access.
- Production API and Nginx were healthy with zero restarts at verification. Caddy
  and cloudflared continued running without a restart. Real-account login was not
  exercised by the smoke checks.
- Previous deployment configuration is backed up at
  `C:/Code/docker-container/unity-hub-website/docker-compose.yml.pre-production-20260927-002754`.

## Verified deployment — 2026-10-02 (firmware builds)

- Migration `20261002000000_build_jobs` applied; `BUILD_WORKER_TOKEN` in the root
  `.env`, read by both `nestjs` and `build-dispatcher`.
- Rollback tags: `rollback-before-onboard-led` (API and web before the onboard-LED
  change). The tags taken before the builds release were not kept.
- Through the public origin: `/` 200, `/api/health` 200,
  `POST /api/internal/build-jobs/claim` 404.
- A queued ESP32 blink job (inserted directly, `requested_by` null, deleted after)
  was claimed by the dispatcher and built in 24 s; images were stored at offsets
  0x1000, 0x8000, 0xE000, 0x10000.

