# /user/documents — Documents

- Routes: `/docs` (public), `/user/documents` (signed in),
  `/user/projects/:projectId/documents` (inside a project)
- Files: `frontend/src/app/features/user/documents/`
- Backend: none
- Status: Partial
- Last verified: 2026-09-29

## What the user can do here

- Switch between two tabs: authored guides, and a reference for every part the
  virtual workspace supports.
- Read 17 Thai guides covering onboarding, project management, the IDE, wiring,
  simulation, project AI, dashboard design, document browsing, community,
  troubleshooting, and the existing board/networking topics.
- View a labelled wiring illustration for ESP32 with an LED, a push button, and
  a KY-038 sound sensor controlling an LED; open the image at full size and
  follow Thai connection tables and voltage guidance.
- Switch between eleven interactive ESP32 wiring diagrams: the combined circuit
  plus an LED, push button, potentiometer, LDR module, IR obstacle sensor,
  PIR HC-SR501, DHT22 with a 10 kΩ pull-up, SG90 servo, 1-channel relay, and
  0.96" I2C OLED, each with its wire list, parts list, and coding tips.
- Follow prerequisites, numbered steps, expected results, and troubleshooting
  tables. The first ESP32 walkthrough works without hardware. Hardware upload,
  browser-only dashboard persistence, and placeholder publishing are distinguished.
- Browse all 72 catalog parts across 14 categories, each with its artwork, a
  Thai summary, what it is used for, the mistake that breaks it, and its full pin
  table.
- Read a full Thai datasheet for every part: wiring, worked calculations, code,
  and the failure modes that only show up on a bench.
- Filter by category and search — guides by title and description, parts by Thai
  name, English name, model, catalog tags, and aliases.
- Open either in a side reader and close it with the backdrop, the close button,
  or Escape.
- Select two to four devices across categories and compare their capabilities,
  suitable uses, limitations, voltage, interfaces, and pin counts side by side.
  Selection survives category, search, and tab changes within the page. Remove
  individual selections or clear all from the comparison tray.

Comparison uses the existing `DeviceReference` summary, usage, and caution fields;
missing limitations are explicitly marked as unavailable. It does not infer a
winner or imply that devices in different categories are interchangeable. The
native modal dialog contains keyboard focus, closes with Escape, and returns
focus to its trigger. Its table scrolls horizontally on narrow screens.

All user-facing text on this page is Thai, per `docs/CONVENTIONS.md` § Language.

## How it works

The project sidebar opens documents, the IoT assistant, and community under
`/user/projects/:projectId/`. Only the main router outlet changes; project
identity and navigation remain in the existing shell. Community thread and
composer links retain that project path, including after a refresh.

Guide prose lives in `documents/guides/*.md`. The build treats `.md` as text
(`angular.json:53`), so `documents.catalog.ts` imports each file as a plain
string and stores it on the article's `body`. `src/markdown.d.ts` declares the
module shape. Nothing is fetched at runtime.

Guides may include an optional `illustration` in their catalog metadata. The
reader uses `NgOptimizedImage` with explicit dimensions and alternative text,
and links to the original asset for full-size viewing. The basic wiring guide
uses `public/images/guides/basic-wiring.svg`, a connection schematic whose pin
positions are intentionally not a physical board pinout.

The basic wiring guide also includes `WiringGallery`
(`features/user/documents/wiring/`): eleven diagrams, starting with one ESP32
DevKit 38-pin board connected to a red LED through 220 ohms, a push button, and
a 3.3 V KY-038 module, followed by ten single-device circuits. Each example is
data in `wiring/examples/*.ts`; `buildWiringExample` resolves wire endpoints
from catalog pin positions (throwing on an unknown part or pin) and turns each
authored orthogonal route into a path. Parts reuse `DeviceArt`, and wire
colours come from the shared device palette. Numbered connection buttons highlight individual wires;
zoom keeps the drawing scrollable on narrow screens. The original individual
schematics remain available in a disclosure. This is a wiring reference, not a
running simulator, and it does not mutate a project.

The device tab derives everything factual from `DEVICES` — the same catalog the
canvas draws from and `export-device-catalog.ts` ships to the backend wiring
validator. `device-reference.ts` projects it into `DEVICE_REFERENCES`: pins, pin
types, directions, voltage window, and interfaces all come from the catalog, and
the category filter reuses `deviceCategoryLabel`, whose labels were already Thai.
Adding a part to the catalog makes it appear here with no edit to this feature.

Artwork comes from `DeviceThumbnail`, the component the Add Device modal already
uses. It renders `DeviceArt` — the same shape list the canvas draws — in the
part's default property state, fitted to its declared bleed. Each card shows it
small; the reader shows it again at 13rem. There is no second drawing to keep in
step: a change to a part's `render.draw` shows up on the canvas, in the modal, and
here at once.

Thai prose is the one thing that cannot be derived, so it lives in two places
keyed by device id. `device-notes.th.ts` holds the card-length copy — name,
summary, usage, caution. `device/*.md` holds the datasheets, wired up by
`device-datasheets.ts` and loaded by the same `.md` text loader as the guides.

40 files cover 72 ids. Parts that differ only by count or size share one file — one
relay document covers all four channel counts, one breadboard document covers three
sizes — because four near-identical files drift apart one edit at a time. The same
idea covers a circuit rather than a part: the LDR, flame, rain, and sound sensors
all ship on the identical LM393 breakout, so `comparator-module.md` is their shared
wiring document, and `mq-series.md` covers the MQ-3, MQ-7, and MQ-135, which differ
from each other only in what the heated bead responds to.

A device missing either file still renders. Without a note it falls back to its
model name; without a datasheet the reader says the full document is pending. That
path is currently unreachable — coverage is 72 of 72 — but it is what a part newly
added to the catalog hits before anyone writes its prose.

Pin labels are translated from the `PinType` and `PinDirection` unions, not from
the English `description` strings in the catalog. Those strings are free to
change; the unions are not, so a new pin type fails the build here instead of
silently rendering English into a Thai table.

`DocumentsPage` holds view state only: `tab`, `query`, the two category signals,
and the two selection signals. Switching tabs clears the query, because a guide
search term matches no device and would land the user on an empty tab.

Markdown rendered into `[innerHTML]` receives no view-encapsulation attributes,
so those element styles are global, scoped by component selector as
`app-documents-page .reader-body` in `src/styles.css` — the same arrangement the
AI assistant already uses for `.markdown-content`. The device panel is ordinary
template markup, so its styles stay in `documents.page.css`.

The reader is `aria-modal`, so opening it moves focus to its close button and
closing it returns focus to the card that opened it. The focus-in step runs
behind a one-shot flag: an unguarded `afterRenderEffect` would drag focus out of
the body every time the user scrolled or tabbed inside it.

## What is not real yet

- No service and no endpoint. Both tabs are compile-time constants; nobody can
  add, edit, or upload a document through the UI.
- The datasheets are authored prose, not manufacturer documents. Coverage is
  checked against the catalog; accuracy is not checked against vendor PDFs, and
  those PDFs are not modelled anywhere in the app.
- Guide search matches titles and descriptions only, not bodies.
- Artwork is a static illustration. Pins are not labelled on the drawing and
  nothing animates; the pin table is the only place pin names appear.

## Decisions made here

- Guide prose lives in `.md` files, not a TypeScript array of strings, so it can
  be written and reviewed as text. A frontmatter parser plus a generated index
  was rejected as unnecessary machinery for the authored guide catalog.
- Build-time text imports over `public/` plus `fetch`. Both need a rebuild to
  publish a change, so the fetch version bought nothing and added a network
  failure path.
- Device facts are derived from the live catalog rather than a generated JSON.
  The cost is real: importing `DEVICES` pulls the whole catalog — artwork,
  shapes, simulation factories — into this route's chunk. Paid deliberately, on a
  lazy route, to buy a reference that cannot drift from what the canvas and the
  backend validator use.
- Datasheets are bundled eagerly with the route, like the guides. The 2026-09-29
  build reports 691.81 kB raw / 78.32 kB estimated transfer for the documents chunk.
  Opening one device also downloads the other authored documents. Accepted at
  this size; the reasoning against runtime fetching weakens as the catalog grows. The
  replacement is a dynamic `import()` per datasheet, which splits each into its own
  chunk without moving anything to `public/` — see follow-up 4.
- `device-notes.th.ts` holds prose only. Any electrical fact copied into it would
  be a second source of truth, which is the exact failure `export-device-catalog.ts`
  exists to avoid.
- `MarkdownPipe` sanitizes explicitly and returns a plain string, so Angular's
  `[innerHTML]` sanitizes a second time. This holds even though guide content is
  authored in-repo — the pipe has two callers and must not develop a trusted mode.

## Verification

- Wiring gallery verified on 2026-10-06: `npx tsc -p tsconfig.app.json` and
  `npx ng build` pass. `npx playwright test e2e/basic-wiring.spec.ts` passes two
  tests, now including switching examples and resetting wire selection. All
  eleven diagrams were screenshotted and inspected for overlapping wires, badges,
  and labels. Pin assignments follow vendor defaults but were not tested on
  physical hardware.
- Combined wiring example verified on 2026-10-02: `npm.cmd run build` passes
  Angular template and TypeScript checks. `npx.cmd playwright test
  e2e/basic-wiring.spec.ts` passes two tests covering guide search, keyboard wire
  selection/reset, the individual schematic image, Escape/focus restoration, and
  zoom/keyboard scrolling without reader overflow at a 390 px viewport. Desktop
  and mobile artwork were also inspected visually; no physical hardware was tested.
- Guide expansion verified on 2026-09-29: `npm.cmd run build` passes, including
  Angular template and TypeScript checks. Catalog checks confirm 16 unique guide
  IDs, valid categories, nonempty bodies, balanced code fences, and intact encoding.
- A temporary Playwright smoke check against the production build at `/docs`
  opened all 16 guides, searched each title, checked every category count, and
  verified Escape and focus restoration. The community reader fits a 390 px
  viewport; no browser page errors occurred. This did not exercise authenticated
  project actions or physical hardware.
- The exact C++ snippet from `first-esp32.md` compiles in `FirmwareMachine` and
  emits its startup message and repeated loop messages with baud rate 115200.
- Device comparison verified on 2026-09-26: `npm.cmd run build` passes.
- `npx.cmd playwright test e2e/device-comparison.spec.ts` passes both browser
  tests: cross-category selection, the four-device limit, filter/tab persistence,
  removal/reset, existing detail-reader access, modal keyboard focus and Escape,
  missing limitations, and horizontal comparison scrolling at 390 px width.
- A script over the catalog dump confirms `device-notes.th.ts` and
  `device-datasheets.ts` each cover 72 of 72 devices, with no orphaned keys and no
  unreferenced files under `device/`.
- Note: `angular.json` is read once at process start. A running `ng serve` keeps
  failing with `No loader is configured for ".md" files` until it is restarted.

## Follow-ups

1. Back manufacturer PDFs with Supabase Storage plus a metadata table, linked
   from each part's authored datasheet.
2. Extend guide search to bodies now that they are real text.
3. Link each device to the guides that mention it, and each guide to the parts it
   uses.
4. Split datasheets into per-device chunks with dynamic `import()` when the
   transfer cost stops being acceptable. Adds a loading state to the reader.
5. Reconsider deriving the device reference at build time if the chunk cost
   becomes a problem — the projection in `device-reference.ts` is already the
   shape a generator would emit.
