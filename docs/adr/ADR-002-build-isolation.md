# ADR-002: Firmware Build Isolation

- Status: **Proposed — blocked on an infrastructure decision by the platform owner**
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

## Decision Required

The platform owner must choose the isolation mechanism. This ADR moves to Accepted
once that choice is recorded here, together with:

- where workers run (same host, separate host, or managed service);
- the queue technology (PostgreSQL-backed job table, or Redis);
- concurrent build budget and per-build resource limits;
- artifact retention policy in Supabase Storage.

Until then the build endpoint stays disabled and returns
`503 BUILD_TEMPORARILY_DISABLED`. That state is safe and can be held indefinitely.

## Consequences of the current disabled state

- The Web IDE edits and stores files but cannot compile. Users see an explicit
  banner rather than a broken build.
- Serial monitoring is unavailable until flashing moves to Web Serial or a local
  agent, which is a Phase 4 deliverable rather than a regression to be undone.
- A regression test in `workspace-firmware.service.spec.ts` fails if any file in the
  workspace module reintroduces a process-spawning import or spreads `process.env`
  into a child, so the vulnerability cannot return unnoticed.
