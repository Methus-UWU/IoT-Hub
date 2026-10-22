# /user/projects — Projects

- Route: `/user/projects`
- Files: `frontend/src/app/features/user/projects/`
- Backend: `backend/src/modules/projects/`
- Status: Partial
- Last verified: 2026-09-26

## What the user can do here

- Load and search the active workspace's projects; switch list/grid and sort order.
- Create a project using a supported catalog board and its default framework.
- Select real catalog peripherals for manual setup, set each quantity with minus
  and plus controls, or start with the board alone.
- Read a quota refusal, keep the entered values, and retry creation.
- Open Virtual Device after manual setup; AI setup sends a nonempty creation
  description to the IDE assistant automatically and shows a plan for acceptance.
- Use More options to open either workspace view or confirm permanent deletion
  (workspace owners/admins); failed deletes keep the project visible for retry.
- The project list shows the user sidebar with navigation and account actions.
  On mobile, the header menu button opens the sidebar as a drawer.
- Inside a project, the sidebar shows project navigation and an All projects
  link. Below the current-project links, a separate learning and community group
  links to documents, the IoT assistant, and community. It shares navigation
  metadata and mobile-drawer behavior with the other user pages.

## How it works

`ProjectSetupStore` loads authenticated `GET /api/boards` through
`ProjectsApiService` and reuses the canvas device catalog for peripheral IDs.
`ProjectStore.create` sends those IDs to `POST /api/workspaces/:wid/projects`.
The existing controller requires editor membership; `ProjectsService` validates
the board/framework and `ProjectComponentsService` validates peripherals and plan
capacity, counting the board. `PrismaProjectComponentRepository` creates the
`projects` row and all `project_components` together through one nested write.
The parent page owns request/error state; the native dialog keeps its form until
success. See [API contract](../API.md#creating-a-project).

### Starter files

Each board lists its `frameworks` in `board-catalog.ts`, the default first; the
create dialog offers exactly that list and the API rejects anything else. Arduino
and ESP boards offer `PlatformIO` (default) and `Arduino C++`.

The same nested write stores the project's starter files for the chosen
framework, so a project never exists without them. `project-starter-files.ts`
builds them from catalog data only (no user input reaches them):

- `PlatformIO`: `platformio.ini` with one `[env:<boardId>]` holding the board's
  `platformio` target, `framework = arduino`, `monitor_speed = 115200`, and
  `lib_deps` for the libraries the initial peripherals use; plus `src/main.cpp`,
  an empty `setup`/`loop` sketch with `#include <Arduino.h>`.
- `Arduino C++`: `main.ino`, the same empty sketch without the include.
- `MicroPython`: none.

`pickEntryFile` (`workspace/project-entry-file.ts`) is the one rule for which file
is the sketch; the IDE, simulator, diagnostics, and AI setup page all use it. The
IDE fetches the file list before choosing a tab, so it opens `src/main.cpp`
rather than creating a stray root `main.ino`. Projects created before this keep
their `main.ino`.

For AI creation, `ProjectStore` records a single-use handoff after a successful
create. The IDE initializes a neutral source file, confirms the backend can read
it, and submits the persisted description using the balanced model profile. A
reload does not resubmit. Existing projects can use "Create plan from project
description" in the composer to explicitly retry. Empty descriptions and manual
creation do not trigger generation. Application of the returned plan still requires
the user's acceptance.

`ProjectActionsMenu` owns the card's overflow trigger and renders its actions in a
fixed-position dropdown (the card clips overflow); only deletion escalates to a
native modal for confirmation.
Its scoped `ProjectActionsStore` owns pending/error state and delegates to
`ProjectStore.delete` → existing `DELETE /api/workspaces/:wid/projects/:pid`.
The API requires admin membership and checks project ownership by workspace.
Successful deletion removes the card; failed requests retain it.
Workspace changes invalidate the client operation. Cancellation restores trigger
focus; successful deletion moves focus to New project.

## What is not real yet

- Deployment state is not modelled; cards map every project to draft/not deployed.
- Setup mode is transient navigation intent, not saved project metadata.
- An empty creation description opens the assistant without generating a plan.

## Decisions made here

- Offer only the three boards with actual catalog definitions and pins; retain
  legacy metadata for reading existing projects. No schema changes or new routes.
- Board-only creation is valid. Invalid peripherals or capacity refusals reject
  the entire request before any project is written.
- Dead-code checklist verdict: **Keep the routed creation feature; replace its
  fixture options and premature form reset.** Symbol/file/route references lead to
  `ProjectsPage`; these are not generated files. API/inventory docs are updated,
  service tests cover the revised contract, and dialog history (`a6b0fca`,
  `0aae2d7`) confirms this is an active feature. No files or routes were deleted.
- Card-actions checklist: **Keep and implement** the routed More options button
  (`0aae2d7`); reuse the existing delete endpoint. No generated files were edited.
  The action dialog offers existing navigation and delete capabilities only.

## Verification

- Resource group verified on 2026-10-03: build passes. A temporary Playwright
  check with mocked APIs verified the six project/resource links in order,
  document active state, all three resource destinations on mobile, automatic
  drawer closure, and the four-link navigation outside a project. The desktop
  sidebar was visually inspected; no browser page errors occurred.
- Sidebar restored on 2026-10-03: `npm.cmd run build` passes. A temporary
  Playwright check with mocked account/workspace responses verified the desktop
  sidebar, all four navigation links, account menu, and mobile drawer opening
  and closing at 390 px. No browser page errors occurred.
- Creation-description regression: a browser enters the brief in the create dialog,
  observes exactly one AI request after remote source initialization, accepts a
  plan, and reloads source and device positions. Explicit regeneration from an
  existing description also passes. API persistence is mocked in this regression.
- The unrelated soil/Wi-Fi starter is replaced with a neutral sketch. Existing
  stored files are preserved; explicit generation requests replace starter behavior
  that does not match the brief. The removed Python soil template was local to
  `defaultCode`, not generated, and had no other source or documentation references.

- Backend: `npm.cmd run build`; `node node_modules/typescript/bin/tsc --noEmit -p
  tsconfig.json`; targeted ESLint: passed.
- `npm.cmd test -- --runInBand --silent`: 17 suites, 248 tests passed. Exception
  filter tests intentionally print error logs (creation pass).
- Frontend: `npm.cmd run build`: passed with existing bundle/style budget warnings.
  Initial bundle: 632.17 kB; creation dialog CSS: 8.64 kB against an 8 kB warning.
  A later NG8022 failure from duplicate `maxlength` attributes was fixed by using
  the Signal Forms schema alone; see Troubleshooting.
- `node --env-file=backend/.env .tmp/user-projects/verify-database.cjs`:
  real PostgreSQL nested creation and repository reload returned board + DHT22 +
  LED. The transaction rolled back and confirmed no test project remained.
- `node .tmp/user-projects/verify-browser.cjs`: desktop/mobile Chromium passed
  catalog retry, selection, pending/duplicate prevention, retained form after 409,
  successful manual/AI navigation intent, and Escape handling. Scoped axe audit:
  zero violations after fixing text contrast with existing tokens. Screenshots
  are in `.tmp/user-projects/`. This isolated UI check intercepts HTTP and bypasses
  routing guards in browser memory; it is not an authenticated full-stack E2E.
- Card actions: `npm.cmd test -- --runInBand --silent projects-deletion
  projects.service`: 24 passed; backend type-check and targeted ESLint passed.
  A Jest dynamic-import failure was fixed with a static guard import.
- `node .tmp/user-projects/verify-actions.cjs`: desktop/mobile, owner/viewer,
  links, cancel/focus, duplicate prevention, 403/retry, usage refresh and reload
  passed; scoped axe found zero violations. HTTP and route guards are isolated
  test substitutes. No real user project was deleted during verification.

## Creation dialog visual design (September 2026)

- The creation dialog uses a spacious two-column layout with a live project
  preview derived from the existing form state. At tablet and mobile widths the
  preview becomes a compact summary below the fields; actions remain visible.
- Shared surface and text tokens live in `src/styles.css`. The existing native
  dialog, Signal Forms, board dropdowns, and pending/error ownership are retained.
  Name and description validation messages use the shared `field-error` component.
- AI/manual selection uses one full-width segmented toggle. Peripheral choices exclude boards,
  render inside one containing card, and always show quantity controls that stay
  disabled until their peripheral is selected. The desktop device viewport shows
  two complete rows (four cards), hides its scrollbar, and snaps scrolling to full
  rows so partial cards are not left visible. Entry and
  interaction motion stays below 200 ms and respects reduced-motion preferences.
  The active setup segment slides between modes in 180 ms. Device-card hover does
  not translate the card, preventing the first row's top border from being clipped.
  The desktop dialog is compact enough to fit at 900 px viewport height without an
  internal scrollbar; smaller viewports retain scroll behavior with hidden chrome.
  Board/framework selects use the shared compact menu so their options stay inside
  the viewport. Quantity controls use the dense size, and the project preview
  stretches to the bottom of the form column instead of leaving unused white space.
- Verification: production build passed; dialog CSS is 14.46 kB against the 8 kB
  warning threshold (below the 24 kB error threshold). Existing initial bundle and
  unrelated component-style budget warnings remain.
- `.tmp/user-projects/verify-redesign.cjs` passed catalog retry, peripheral quantity,
  duplicate submission prevention, error preservation, AI/manual navigation, live
  preview, Escape, and layout checks at 320/390/768 px. Scoped desktop/mobile axe audits
  reported zero violations after finite transitions settled. These checks use
  intercepted HTTP and isolated browser routing, not authenticated end-to-end data.
- Screenshots: `.tmp/user-projects/redesign-ai-desktop.png`,
  `.tmp/user-projects/creation-desktop.png`, `.tmp/user-projects/creation-mobile.png`.

## Project browser visual design (September 2026)

- Projects use the full content width, with smaller cards, a plain search/filter
  toolbar, a visible project count, updated dates, and a compact list view.
- Loading, no matches, empty accounts, and load errors remain distinct. No-match
  results offer Clear filters; load errors offer Try again using the existing store.
- At the user's request, usage presentation and usage API calls were removed from
  this page, including the creation/deletion refreshes. The Usage sidebar item is
  now hidden, and `/user/plan` redirects to `/user/projects`.
- Removal verdict: remove the explicitly retired page integration and its styles;
  retain the usage service and metric type used outside this page. No routes,
  database code, or generated files were removed.
- `npm.cmd run build` passed, with the existing budget warnings and a project-page
  CSS warning at 8.48 kB (8 kB warning / 24 kB error thresholds).
- `.tmp/user-projects/verify-projects-minimal.cjs` passed search, status filters,
  reset, sorting, grid/list, menu focus, retry, empty-state creation, and layout at
  320/390/768 px. Scoped axe checks found no violations. Verification uses mocked
  HTTP and browser-only routing substitutes; it does not create real projects.
- Screenshots: `.tmp/user-projects/projects-minimal-desktop.png`,
  `.tmp/user-projects/projects-minimal-list.png`,
  `.tmp/user-projects/projects-minimal-mobile.png`.

## Project activity dates (September 2026)

- The card's “updated” date comes from `projects.updated_at`, which represents the
  latest persisted file, component, or connection change—not project creation.
- Migration `20260925000000_track_project_activity` maintains the parent timestamp
  with database triggers and backfills existing rows from their latest child data.
- The projects page forces an API refresh whenever it is entered, so returning from
  the editor cannot display the store's stale timestamp.

## AI setup progress design (September 2026)

- The setup route uses one compact progress surface with a five-step indicator and
  a short live-status row. Detailed tool activity remains available in a collapsed
  disclosure instead of competing with the current task.
- The 42-rem card is centered in the available workspace on normal-height screens;
  short and mobile viewports align it safely from the top. Long activity uses a
  slim, keyboard-focusable internal scrollbar instead of growing the whole page.
- Entry, stage, progress, and newly-added log transitions finish within 180 ms and
  are disabled by `prefers-reduced-motion`. The page no longer nests a second
  `main` landmark inside the workspace shell.
- `node .tmp/project-setup/verify-minimal-ui.cjs` passed desktop/mobile layout,
  collapsed activity behavior, reduced motion, and a scoped axe audit with zero
  violations. Screenshots are in `.tmp/project-setup/`.

## Skeleton loading (September 2026)

- While projects load, the page shows six placeholder cards in the current grid
  or list layout, plus a placeholder beside the heading count, instead of a
  "loading" line. Placeholders reuse the real card classes, so the layout does not
  jump when projects arrive; list view hides the description lines as real rows do.
- The placeholders are `aria-hidden`; a `role="status"` region keeps the loading
  text for screen readers. The shimmer stops under `prefers-reduced-motion`.
- `npx ng build` passed. `projects.page.css` is now 9.52 kB against the 8 kB
  warning threshold (24 kB error).
- A Playwright check held the projects request open and passed: six placeholders,
  screen-reader text, running shimmer, list layout, no overflow at 390 px, reduced
  motion, axe with zero violations in both views, and every placeholder replaced by
  the four mocked projects once released. Like the earlier checks it intercepts HTTP
  and swaps route guards in browser memory; it is not an authenticated run.

## Follow-ups

1. Define persisted deployment/build status before exposing operational filters.
2. Verify authenticated creation/deletion through the full deployed API and workspace UI.
