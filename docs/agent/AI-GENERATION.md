# Work Order — AI Generation in the Project Workspace

The generator already exists end to end: tools, draft, plan, apply. Read
`docs/ARCHITECTURE.md` § "Project-aware AI Assistant" once before touching any of it
— it explains *why* each boundary is there, and most tempting shortcuts here are
things that section already rejected. This file is only the outstanding work and the
rules you must not break while doing it.

## The invariant

```
LLM decides intent → application validates hardware → backend executes → database stores
```

- The model never invents a GPIO number. It asks to wire a pin; `pin-assignment.ts`
  answers with a legal one; the model writes *that* number into the code. Code and
  diagram disagreeing is the exact defect this feature exists to prevent.
- The model never writes to the database. A turn yields a plan. The user accepts it.
  `ai-plan-apply.service.ts` replays it against live state and refuses it whole if it
  went stale.
- No tool takes a project or workspace id. Do not add one.

Any change that lets the model name a pin, name a project, or write directly is a
regression regardless of how well it demos.

## Definition of "it actually works"

A user types one sentence — *"read the room temperature and blink an LED when it is
over 30"* — and, without naming hardware:

1. The assistant searches the catalog and picks parts the project lacks
   (`search_device_catalog`, `add_device`).
2. It wires them, letting the engine choose pins (`wire_to_board`), and the tool
   result tells it the pins it actually got.
3. It reads the existing sketch before rewriting it (`read_source_file`), and writes
   firmware whose pin constants equal the pins from step 2.
4. The user sees a plan listing devices, wires, and file changes, accepts it, and the
   canvas, the wiring, and the editor all show the same circuit after one reload.

Nothing in that list is aspirational — verify each step against the current build
before writing new code. Fix what fails; do not rebuild what passes.

## Datasheets

The assistant reads the platform's own Markdown datasheets through
`read_device_datasheet`, exported from `documents/device/*.md` by
`scripts/export-device-datasheets.ts`. That is where the requirements no pin list
carries live — the DHT's 4.7 kΩ pull-up, the relay board's active-low input — and
reading them is what turns a plausible circuit into a working one. Re-run the exporter
after editing a datasheet; the command is in `ARCHITECTURE.md` § "Why the backend also
holds the datasheets". Never edit the generated file.

The executor records which definitions were read during the current draft. It refuses
`add_device`, `wire_to_board`, and `connect_pins` for a documented non-board part until
its datasheet has been returned. This is an application rule, not a prompt convention.
An unknown id never counts as read; a catalog part whose long-form document is pending
does count after the read tool explicitly reports the gap and supplies the fallback rule.

## Part settings

Inspector properties a user configures, such as an LED's `color` or a relay's
`trigger`, are exported into the backend catalog as `settings`. Live simulation-only
controls are not exported. Search results and pinouts list them. `add_device` takes
`settings`, and `configure_device` changes a part the project already has; that
stages a `configure` action. `resolveSettings` checks every value against the catalog
twice: once in the tool, and again at apply, because the plan comes back from the
browser.

## The board's own LED

Boards with a user LED declare it once, as `onboardLed` on the Angular definition
(`{ pin, label, activeLow? }`), exported into the backend catalog. The same value
drives three things, so they cannot disagree:

- the assistant: `onboard-led.ts` puts "Onboard LED: pin GPIO2 … no add_device and
  no wire … `const int LED_PIN = 2;`" in the project context and in
  `get_board_pinout`, and the system prompt says a plain "blink the LED" means that
  LED. An external LED is added only when the user asks for one. Before this, the
  pin description was the only trace of the LED, and "ให้ LED บน ESP32 กะพริบ"
  became a new LED, a resistor, and three wires;
- the simulator: `createBoardBehavior` emits the LED pin's level and the board
  artwork lights from it, instead of glowing whenever the simulation runs;
- `LED_BUILTIN` in the interpreter: the board's LED pin (2 on an ESP32 DevKit),
  no longer 13 on every board.

Live check on 2026-10-02 (free OpenRouter model, `backend/.tmp/ai-onboard-led-bench.ts`):
"เขียนโค้ดให้ LED บน ESP32 ติดดับสลับทุกๆ 3 วิ" planned one `write_file` with
`LED_PIN = 2`; "ต่อหลอด LED สีแดงภายนอกเพิ่ม…" still added an LED, a resistor, and
three wires.

## Model choice (2026-10-02)

The IDE has no X2/X3 mode selector or tier badge in chat history. It sends the
balanced profile and leaves model selection to the backend configuration.

Production pins the project assistant to `deepseek/deepseek-v4-pro-0813`, with
`openai/gpt-5-mini` as its backup (`AI_PROJECT_MODEL`, comma-separated, in order) and
`AI_PROVIDER_SORT=price`, so OpenRouter tries the discounted host first. The best
ranked free model follows them. `AI_ALLOW_PAID_MODELS` stays off: the pins are
consent for those models only, so users still cannot name a paid model and the
ranked fallbacks stay free.

Bench (`backend/.tmp/ai-model-bench.mjs`, one run each, ESP32 project with only the
board): "blink the LED" and "DHT22 + OLED + relay over 30 °C".

| Model | Blink | DHT+OLED+relay | Cost of the complex turn | Complete |
| --- | --- | --- | --- | --- |
| deepseek-v4-pro-0813 (price) | 8 s | 74–89 s | $0.036 measured | yes |
| gpt-5-mini | 9 s | 81 s | $0.030 measured | yes |
| claude-haiku-4.5 | 7 s | 36 s | ~$0.16 from tokens | yes |
| gemini-3.1-flash-lite | 3 s | 17 s | ~$0.03 from tokens | no DHT22 pull-up |
| kimi-k2.6 (price) | 15 s | 183 s | ~$0.06 from tokens | yes |
| deepseek-v4-flash (price) | 53 s | did not finish | – | no |
| free ranking (before) | 44 s | 217 s | 0 | varies |

"Complete" means DHT22, OLED, relay, the 4.7 kΩ pull-up the DHT22 datasheet requires,
12 wires, and the sketch. Re-run the bench before changing the pin; a single run per
model is a signal, not a guarantee.

## Libraries

`simulation/firmware/libraries/library-catalog.ts` names the library that drives
each part, with its includes, `lib_deps` entry, and a minimal correct use. The
exporter writes it to `library-catalog.generated.ts`. The assistant sees it in
search results, pinouts, `add_device` results, and datasheets, and the system
prompt tells it to use exactly that library. The simulator emulates the same set
(ADR-005), so the sketch it writes runs on the canvas. To add a library, add its
emulation and its catalog entry together, then re-run the exporter.

## Creating a project from a description

An AI-mode project with a description opens `/user/projects/:id/setup`, not the IDE.
New projects already hold `platformio.ini` and `src/main.cpp` (see
`docs/pages/user-projects.md` § "Starter files"); the page targets the sketch
`pickEntryFile` chooses and creates `main.ino` only for an older project with no
sketch. It then runs the turn through
`POST …/ai/chat/stream`, which is NDJSON: `progress` lines, then one `result` or
`error` line. When the plan is ready, the page applies it with no accept click,
because the description is the request. Apply still re-validates everything. The
page then lays the new parts out and shows each step as it happens. Progress events
come from `ai-progress.ts`: subjects come from tool-call arguments; structured
statuses distinguish pending, completed, reused, failed, and incomplete wiring.
The waiting screen shows the current milestone, elapsed time, and three recent
activities, with full activity history in a disclosure. A decorative circuit and
indeterminate activity line animate only during generation/apply; users can pause
motion, and reduced-motion preferences disable it. No completion percentage is
inferred from elapsed time or milestone position.
Raw tool output and source never enter progress events. The setup page groups
retries of the same step, renders the final answer with the shared sanitized
Markdown pipe, and counts devices only from the apply result. Staged operations
are labelled as preparation, not persisted changes.

An `add_device` retry reuses the same definition and explicit label even when
`allowDuplicate` is repeated. Different units need distinct labels. Retrying a
staged part can finish its missing wires without creating another component.

## Layout

Apply returns `createdComponentIds`. The chat store then calls
`ProjectCanvasService.arrangeNew`, which runs `virtual-device/layout/auto-layout.ts`:
each new part goes beside the board on the side of the pin it is wired to, level with
that pin. A part reached through another new part — GPIO → resistor → LED — goes
further out on the same row. Existing parts never move. Layout is a client concern
because only the Angular catalog knows part geometry; the backend catalog carries
electrical facts only. A failed move never fails an applied plan.
`npx tsx scripts/verify-layout.ts` checks it.

## Verification path

- Backend unit level: `cd backend && npm test`. The scenario specs are the
  contract — `relay-led-scenario.spec.ts`, `pin-assignment.spec.ts`,
  `ai-tool-executor.spec.ts`, `ai-plan-apply.service.spec.ts`.
- Whole path: drive the request the way the bench rig does, not by clicking only.
  A rig that lights two LEDs through two relay channels catches what a unit test
  cannot — that is how both assignment bugs recorded in `ARCHITECTURE.md` were found.
- Frontend: `/user/projects/:id/ide`, AI panel, then reload the page and confirm the
  circuit survived. `project-ai.service.ts` calls `chat` then `apply`;
  `project-workspace.page.ts:1053` is the accept handler.

## Standing rules

- **Catalog stays generated.** A part is authored once, in the Angular device
  definition. After changing any device, re-run the exporter (command in
  `ARCHITECTURE.md` § "Why the backend holds a copy of the catalog") and commit the
  regenerated file. Never hand-edit `device-catalog.generated.ts`.
- **Manual and AI wiring have different risk boundaries.** The canvas reports unusual
  but physically possible wiring as dismissible diagnostics. AI proposals must withdraw
  a newly staged wire when validation reports overvoltage, undervoltage, or two driven
  outputs; the model cannot knowingly accept hardware damage on the user's behalf.
- **Assignment order is a decision, not an accident.** Existing wire, then a legal
  free preference, then board header order with exact type ahead of substitute, and
  supply rails inside the part's declared window chosen lowest-first. Within those
  tiers, `preferSide` breaks ties by header side: first the side the part is already
  wired to (so its GND lands beside its signal), otherwise the side with fewer
  occupied pins. A substitute never jumps ahead of an exact type. The layout then
  places each part on its pins' side, so parts spread over both headers and their
  wires stop crossing the board. Changing this order changes which circuits work —
  add a spec with the change.
- **Read before write is enforced twice** — in the prompt and in code, where a write
  that would cut a file by more than half is refused. Keep both.
- **The plan is untrusted input on the way back in.** Apply re-resolves membership
  and ownership and re-validates against live state. An id inside a plan grants
  nothing.

## Likely remaining gaps — confirm each before acting

1. Non-blocking warnings from the assignment engine reaching the user. AI-dangerous
   warnings (overvoltage, undervoltage, output conflict) are withdrawn and refused.
   Any future advisory warning that remains staged must also be routed into the plan.
2. Failure surface. When apply refuses a stale plan, the user must be told what
   changed underneath, not shown a generic error toast.
3. Catalog coverage. A part that is drawn but declares no pins cannot be wired — the
   defect the relay had. Audit the catalog for other parts whose artwork promises
   terminals their definition does not declare.
4. Code generation targeting the real toolchain. Firmware the assistant writes must
   compile through the same build path as hand-written code, not a separate one.
   That path now exists (ADR-002): the IDE's Build compiles the stored files in the
   isolated builder. The onboard-LED blink compiled there on 2026-10-02; nothing yet
   feeds a build result back to the assistant automatically.
5. Editor and canvas agreement after apply. Both read project state; confirm neither
   holds a stale in-memory copy after a plan lands. Verified in the browser on
   2026-09-25 for the editor and the canvas, one project each.
6. Circuits that are legal and pointless. Closed for the shorted series resistor:
   `bypassedCurrentLimiters` finds a current limiter whose leads reach one node and
   `auditCircuit` reports it, so the assistant sees it in the problems block. The
   browser's own checker in `simulation/wire-validation.ts` still has no equivalent
   rule, and other legal-but-pointless shapes have not been looked for.

## Do not

- Add a tool that deletes by row id. Wires are addressed by the two pins they join
  so a hallucinated id cannot destroy a real wire.
- Move hardware validation into the prompt. A rule stated only in English is not a
  rule.
- Run generated user code inside the API process. Isolated build workers only.
