---
name: verify
description: Build, launch, and drive the IoT Hub admin frontend to verify changes at the browser surface.
---

# Verifying frontend

Angular v22 SPA (Tailwind v4). No backend needed: `environment.useMockApi = true` makes
`src/app/core/interceptors/mock-api.interceptor.ts` serve in-memory data for `admin/*` endpoints.

## Build / launch

```bash
npx ng build                 # AOT catches template errors; ~5s
npx ng serve --port 4311     # run in background; ready when curl returns 200
```

Port 4300 is often taken by the user's own server — pick another port.

## Drive (Playwright)

No Playwright in this repo. Install `playwright@<version matching npx playwright --version>`
in the session scratchpad (browsers are already in `%LOCALAPPDATA%/ms-playwright`), then drive
with a node script using `chromium.launch()`.

Flows worth driving:
- `/` redirects to `/admin/dashboard`; sidebar = 6 items (Dashboard, Server, Database & Backup, Logs, Users, Settings)
- Server: Restart/Stop/Start per service → inline Confirm/Cancel → badge goes `restarting` → `running` (~3s)
- Database & Backup: Create backup → `in-progress` row, button disabled → flips `completed` ~2.5s later; Restore/Delete have inline confirm
- Users: search filters by username/email/role; Suspend/Activate toggles the badge
- Settings: invalid email blocks save with message; save shows "Settings saved."

## Gotchas

- First page load after `npm install` triggers a vite "Re-optimizing dependencies" reload that
  can interrupt a running Playwright script mid-flow → flaky counts. Warm the server with one
  `curl`/page load first, or re-run the failing step in isolation before calling it a bug.
- Mock state lives in browser module memory: a full page reload resets users/backups/settings.
- Capture `page.on('console')` errors — router/template errors surface there, not in HTML.
