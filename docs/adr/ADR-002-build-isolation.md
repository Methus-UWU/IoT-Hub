# ADR-002: Firmware Build Isolation

- Status: **Accepted — implemented 2026-10-02**
- Date: 2026-08-28
- Related: `docs/SECURITY.md`, `docs/ARCHITECTURE.md` (Phase 4), `docs/LEGACY_AUDIT.md` (S1, S2, Q3)

## Context

The capability is currently **disabled**, not merely deprecated. Phase 0 deleted the
implementation because it was remote code execution against a process holding every
platform secret:

- `pio run` executed with `execFile` inside the NestJS API process.
- The staging directory was assembled from user-supplied files, including a
  user-supplied `platformio.ini`, which can run arbitrary Python through
  `extra_scripts`.
- The child received `{ ...process.env }`: `DATABASE_URL` with the database
  password, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and every AI provider key.
- The same services exposed every serial port on the API host to any authenticated
  user, with no ownership check.

Restoring the capability safely requires infrastructure that does not exist yet, and
choosing it has real cost and operational consequences. That is why this ADR is
proposed rather than accepted.

## Requirements

Non-negotiable, from `docs/SECURITY.md`:

1. User source and `platformio.ini` are hostile input.
2. The worker holds no application database credentials, no Supabase service-role
   key, no AI provider secret, no JWT secret.
3. The worker is non-root, CPU limited, RAM limited, timeout limited, disk limited,
   and network restricted as far as the toolchain permits.
4. A build cannot read another user's files or reach the host filesystem.
5. Ephemeral where practical: a build starts from a clean root.
6. No arbitrary server terminal is exposed.

Architectural, from `docs/ARCHITECTURE.md`:

7. `Angular → NestJS API → Build Job → Queue → Isolated Worker → Artifact → Result`.
8. The API enqueues and returns immediately. Builds must not hold a request open,
   as the previous implementation did for up to 180 seconds.
9. Build status reaches the browser over WebSocket as `build.status.changed`.
10. **BUILD is separated from FLASH.** The worker never touches physical hardware.
    Flashing moves to the browser via Web Serial, or to a trusted local agent that
    the user runs on their own machine. This is also what makes the old serial
    endpoints unnecessary rather than merely disabled.

## Options

### A. Docker container per build, on the same host

Queue in PostgreSQL or Redis; a worker process claims a job and runs
`docker run --rm --network=none --read-only --user 1000 --memory=2g --cpus=1` with
the project mounted at a temporary path and the PlatformIO core cache mounted
read-only.

**For.** Simplest to operate, no new provider, works locally and in CI, cheap.
Satisfies every requirement above except that container escape is a kernel-boundary
risk rather than a hardware one.

**Against.** The Docker socket must be reachable by the worker, which is itself a
privilege boundary that must be handled carefully — the worker holds the queue
credential, so socket access must not be combined with secret access in one process.
Cold PlatformIO toolchain downloads are slow without a warmed cache volume.

**Cost.** Effectively zero beyond existing hosting.

### B. microVM per build (Firecracker or gVisor)

**For.** A genuine hardware or syscall-level boundary rather than a shared kernel.
The right answer if untrusted builds ever become a public, unauthenticated feature.

**Against.** Substantially more operational surface: image build pipeline, VM
lifecycle, networking, and metrics. Firecracker needs bare metal or nested
virtualisation, which most managed hosts do not offer.

**Cost.** Meaningful — usually a dedicated bare-metal or nested-virtualisation host.

### C. Managed CI runner (GitHub Actions, or similar) as the build backend

**For.** Isolation, limits, and artifact storage are somebody else's problem.

**Against.** Minutes are billed and queue latency is unpredictable, which is a poor
fit for an interactive Web IDE. Build inputs leave the platform, which needs its own
privacy review. Ties the product to an external provider's availability.

**Cost.** Per-minute billing that scales with user activity.

## Recommendation

**Option A** for the first implementation, with the worker deliberately structured so
that Option B is a change of executor and not a change of architecture: the queue
contract, the artifact contract, and the "no secrets in the worker" rule are
identical under all three options.

Revisit if untrusted builds become available to unauthenticated users, or if a
tenant-isolation requirement arrives that a shared kernel cannot satisfy.

## Decision (2026-10-02)

The platform owner chose, on 2026-10-02:

| Question | Decision |
| --- | --- |
| Isolation mechanism | **Option A** — one Docker container per build on the existing host |
| Queue | **PostgreSQL job table** (`build_jobs`), claimed with `FOR UPDATE SKIP LOCKED` |
| Flashing | **Web Serial in the browser** — esptool-js for ESP32, STK500v1 for Uno/Nano |
| Where workers run | Same host as the API, as the `build-dispatcher` Compose service |
| Concurrency and limits | 1 build at a time by default (`BUILD_CONCURRENCY`); per build 1.5 GB RAM (no swap), 1 CPU, 256 pids, 768 MB workspace tmpfs, 300 s timeout |

How the requirements above are met:

1. Hostile input: the project's `platformio.ini` is never used; the builder
   generates one from `build-worker/builder/targets.json`. Library `extraScript`s
   still run, inside the container.
2. No secrets: the builder container gets source files on stdin and nothing else.
   The dispatcher, which holds the Docker socket, holds only `BUILD_WORKER_TOKEN`:
   it talks to the API's worker routes instead of to the database, so the socket
   and a database credential never share a process.
3. Limits: see the table; `--network=none` because every platform, toolchain,
   framework, and catalog library is preinstalled in the image.
4. No other user's files, no host filesystem: no mounts at all; read-only root;
   writable state only on size-limited tmpfs.
5. Ephemeral: `docker run --rm`, one container per build.
6. No terminal: nothing but the builder entrypoint runs.
7–8. The API inserts a queued row and returns 202.
9. **Deferred:** the browser polls `GET .../builds/:id` until Phase 6 adds the
   WebSocket gateway and `build.status.changed`.
10. Build is separated from flash: the server never sees a serial port.

### Deviation: artifacts in Postgres, not Supabase Storage

Images are stored in `build_artifacts` (`BYTEA`), not Storage. Only the newest
successful build of each project keeps them, they are at most about 1.5 MB, and
in Postgres they cascade with the project and are written in the same transaction
that marks the build succeeded. Storage objects do not cascade, so a deleted
project would leave orphaned firmware behind. Revisit if images grow (OTA bundles,
filesystem images) or retention needs to grow beyond one build per project.

### Consequences

- Builds are off until `BUILD_WORKER_TOKEN` is set for both the API and the
  dispatcher; `POST .../builds` answers `503 BUILD_WORKER_NOT_CONFIGURED`.
- Supported boards are those with `flash` in the board catalog: ESP32 DevKit V1,
  ESP32 DevKit 38-pin, ESP32-CAM, ESP32-WROOM-32, Arduino Uno, Nano, and Mega 2560
  (Mega builds; the browser offers its `.hex` as a download, since STK500v2 is not
  implemented). ESP32-S3, ESP8266, and MicroPython are refused with
  `BUILD_NOT_SUPPORTED` until their platforms are added to the image.
- Web Serial exists only in Chromium desktop browsers; elsewhere the IDE says so.
- Since 2026-10-11, registry libraries can also arrive as project files under
  `lib/`, installed by the Library Manager without network access in the builder
  (ADR-006). The baked list remains the set available to every project by default.
- The builder image is about 2.2 GB. Adding a platform or library is an image
  rebuild, by design: a build cannot download anything.
- `src/common/security/no-process-spawn.spec.ts` replaces the workspace-module
  regression test and now covers the whole API source tree.
