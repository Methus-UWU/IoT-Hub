# Troubleshooting Runbook

Failures seen in this repository and what fixes them. Add an entry whenever you lose
more than a few minutes to something non-obvious. Keep entries in the same shape:
symptom, cause, fix.

## Running the stack

```bash
# backend  (http://localhost:3000/api/)
cd backend && npm install && npm run prisma:generate && npm run start:dev

# frontend (http://localhost:4200)
cd frontend && npm install && npm start
```

Backend tests: `cd backend && npm test`. Lint: `npm run lint`.
Frontend build: `cd frontend && npm run build`.

## Environment

**Symptom** — PowerShell refuses `npm` because `npm.ps1` cannot run under the
current execution policy.
**Cause** — PowerShell selects the script shim before the Windows command shim.
**Fix** — use `npm.cmd` (and `npx.cmd` when needed). Do not change the machine's
execution policy to run a project command.

**Symptom** — a database verification returns `AggregateError` / `EACCES`, or the
API cannot bind `0.0.0.0:3000`, while builds and tests work.
**Cause** — the execution sandbox restricts outbound connections or listening
addresses. This is not evidence of bad database credentials.
**Fix** — use loopback for local verification servers and request the execution
tool's network escalation for the specific read-only live query when necessary.
Keep connection strings and driver error details out of tool output.

**Symptom** — backend boots then every request fails on Supabase, or Prisma cannot
connect.
**Cause** — `backend/.env` missing or incomplete.
**Fix** — copy `.env.example` and fill `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `OPENROUTER_API_KEY`. `SUPABASE_SECRET_KEY` bypasses RLS and
belongs to the API only — it must never appear in `frontend/src/environments/*`,
which carry the publishable key alone.

**Symptom** — the AI assistant answers nothing, or bills unexpectedly.
**Cause** — missing `OPENROUTER_API_KEY`, or paid models enabled.
**Fix** — the model list is fetched at runtime and ranked per task; no model id is
pinned in code. Paid models stay out of the ranking unless `AI_ALLOW_PAID_MODELS` is
exactly `true`. Leave it unset to stay on free models.

## Frontend

**Symptom** — refreshing a public page briefly replaces the account name/initials
with a generic user or guest label.
**Cause** — session restoration finishes before `/auth/me`, and both unresolved
states were rendered as a completed identity.
**Fix** — `AuthService.identityLoading` drives the nav and community composer
skeletons. A tab-scoped `sessionStorage` cache holds only the last API-confirmed
username and its user id. It is reused only for the restored account, refreshed
after profile reads/edits, and cleared on logout/account changes. Cached display
data never populates `currentUser` or grants a role. Late profile responses from
a different or signed-out account are ignored.

**Symptom** — dragging the purple AI panel divider makes the editor minimap flicker.
**Cause** — Monaco's automatic layout clears the minimap canvas on resize but defers
its repaint to a later animation frame, exposing a blank canvas during dragging.
**Fix** — `MonacoCodeEditor` observes its host size and calls `editor.layout()` with
immediate rendering before paint. Keep automatic layout disabled to avoid competing
resize observers, and disconnect the observer when the component is destroyed.

**Symptom** — the generated birthday sketch displays its LCD text but RGB LEDs
stay dark and the buzzer never plays after Run.
**Cause** — the simulator previously treated `sizeof(melody)` as an unknown
function, stopping at the first song loop. Reference parameters in
`colorWheel(pos, r, g, b)` also behaved like copies, leaving caller channels zero.
The toolbar only read compile faults, hiding the later runtime failure.
**Fix** — the firmware parser/interpreter now supports declared array/scalar
sizes and reference parameters; the loader publishes runtime faults each tick.
Verify with `npm test` in `frontend`: `verify-firmware` covers melody playback
and PWM color changes together. The original saved sketch requires no rewrite.

**Symptom** — device artwork shows outlines but its board, plastic, and metal
fills are transparent.
**Cause** — `display: contents` on the SVG `<defs>` host prevents its gradients
from painting in Chromium.
**Fix** — leave `DeviceGradients`' native `<defs>` display behavior intact. Keep
the shared material palette; changing device colors does not fix missing paints.

**Symptom** — a browser refresh assertion sometimes sees the previous timestamp,
even though the backend returns a new snapshot.
**Cause** — after keyboard activation, the test finds the existing button before
Angular has updated its loading label and before the HTTP response arrives.
**Fix** — register `page.waitForResponse` before activating refresh, await that
response, then assert the rendered state. Do not add arbitrary sleeps or change
application refresh behavior to satisfy a racing test.

**Symptom** — a page 404s or returns HTML from the API.
**Cause** — the page calls an endpoint no backend module serves. See the Orphan rows
in `PAGE-INVENTORY.md`.
**Fix** — build the module or delete the call. Do not add a client-side fallback that
hides it.

**Symptom** — signing in with OAuth or an email link lands on the login page again.
**Cause** — something moved `auth/callback` inside the `guestGuard` block. The
visitor arrives already carrying a session in the URL fragment, and the guard
redirects before the Supabase client has read it.
**Fix** — keep `auth/callback` as a top-level route outside `/auth`.

**Symptom** — the Monaco editor renders blank or throws about workers.
**Cause** — the editor worker entry (`monaco-editor.worker.ts`) is not wired into the
build, or the component was moved without it.
**Fix** — keep the worker registration next to `monaco-code-editor.ts`.

**Symptom** — a style works in one page and not another.
**Cause** — Angular style encapsulation; the element is rendered into a floating
layer outside the component.
**Fix** — the few global escapes live in `styles.css`, each with a comment saying why.
Add to that pattern only when encapsulation genuinely blocks the rule.

**Symptom** — project creation clears the form before a failed API request returns.
**Cause** — Angular `output().emit()` returns `void`; awaiting it does not await the
parent's HTTP request.
**Fix** — keep pending/error state in the parent that awaits the store operation,
pass both into the dialog, and close only after success. Preserve the model after
failure and refuse repeat submissions while pending.

**Symptom** — Angular reports NG8022 for `maxlength` on an input with `[formField]`.
**Cause** — Signal Forms owns attributes derived from schema validation; declaring
`maxlength` again in the template conflicts with `maxLength(...)`.
**Fix** — declare the limit in the form schema only. Rebuild the app before running
browser checks; a Vite error overlay otherwise intercepts clicks on the stale UI.

## Backend and data

**Symptom** — project AI waits for many minutes with only a typing indicator.
**Cause** — the round cap allowed 25 provider calls of up to 60 seconds each, with
no whole-request deadline. Serial pinout, add and per-pin wiring calls increased
the number of upstream trips.
**Fix** — a three-minute deadline aborts generation with `AI_GENERATION_TIMEOUT`.
Initial board/source reads are preloaded; `add_device.wirePins` combines peripheral
placement and validated wiring. The composer displays elapsed time. These changes
reduce round trips but do not guarantee that a free upstream completes a request.

**Symptom** — an AI-mode project opens with `SOIL_SENSOR = 34`, an unconfigured
Wi-Fi loop, and only a board despite a different creation description.
**Cause** — the IDE supplied a fixed soil-monitoring starter, and creation stored
the description without handing it to the assistant.
**Fix** — AI creation now consumes a single-use description handoff after source
initialization. The starter contains no invented hardware or network configuration.
For an existing project, use the composer's "Create plan from project description"
action, then accept the resulting plan. See `docs/pages/user-projects.md`.

**Symptom** — AI adds a sensor and some wires but stops before writing firmware.
**Cause** — the previous eight-round tool budget was too short for a sensor,
indicator, resistor and their wiring.
**Fix** — the project assistant allows up to 24 tool rounds followed by a final
read-only round. Exhaustion raises `AI_GENERATION_INCOMPLETE` instead of returning
an unfinished plan for acceptance. Calls to tools absent from the current round
are refused.

**Symptom** — live project generation stops with `AI_RATE_LIMITED` / HTTP 429.
**Cause** — OpenRouter rejected the request under its rate or quota policy. The
adapter preserves 429 even if the error arrived inside an HTTP 200 envelope.
**Fix** — retry after provider capacity/quota is available. The creation description
remains on the project and the composer provides an explicit retry action. Do not
enable paid models to work around this without operator authorization.

**Symptom** — project AI fails with "OpenRouter returned no text output", or a
short request produces incomplete wiring and invalid pin constants.
**Cause** — an upstream can return an error inside HTTP 200; choosing only one
model made that fatal. The fast profile could also select a small chat model for
a short request that actually needs coordinated tools.
**Fix** — the provider now recognizes embedded errors, and automatic project
requests use at least balanced ranking with up to three eligible tool models in
native fallback routing. Hardware instructions require supply, ground, and signal
wiring together with matching source. See `ARCHITECTURE.md` section "Project AI
model reliability" for policy and verification boundaries. The live API accepts
at most three entries in `models`; four returns HTTP 400.

**Symptom** — a Nest unit test fails with "A dynamic import callback was invoked
without --experimental-vm-modules" when overriding a guard.
**Cause** — the CommonJS Jest runner cannot execute that test's dynamic import.
**Fix** — statically import the guard and pass its class to `overrideGuard`; no
runner flags or production authentication changes are needed.

**Symptom** — an interactive `$transaction` callback fails type-checking as if
Prisma expected an array of promises.
**Cause** — `PrismaService.db` is a union of the generated client and the
read-replica extension; their generated callback overloads are incompatible.
**Fix** — in the repository, narrow to the unchanged transaction API with
`as Pick<PrismaClient, '$transaction'>`. Keep this typing boundary inside the
repository and verify the actual query against PostgreSQL. The admin database
repository uses this boundary; no generated client edits are needed.

**Symptom** — Prisma client types do not match the schema.
**Fix** — `npm run prisma:generate`. Never edit anything under `src/generated/`.

**Symptom** — the AI proposes a device the API rejects, or a pin the canvas does not
have.
**Cause** — the generated backend catalog is stale after a device definition changed.
**Fix** — re-run the exporter (command in `docs/ARCHITECTURE.md` § "Why the backend
holds a copy of the catalog") and commit the regenerated file.

**Symptom** — applying an AI plan fails with a staleness error.
**Cause** — the project changed between the proposal and the accept. The plan is
replayed against live state and refused whole rather than applied half-way. This is
correct behaviour.
**Fix** — re-ask. If the message is unhelpful, improve the message, not the check.

**Symptom** — a wire the user expects is refused.
**Cause** — refusals cover only what cannot exist: unknown pin, kind mismatch, supply
shorted to ground, fan-out exceeded, a not-internally-connected pin, a component
outside the project.
**Fix** — if the case is one a real bench would allow, it belongs in the warning set,
not the refusal set. Change it in `wire-validation.ts` with a spec.

**Symptom** — a part draws terminals that nothing can be wired to.
**Cause** — the artwork declares screws the definition does not declare as pins — the
defect the relay module had.
**Fix** — one source for both artwork and pin positions, so a pin cannot drift from
the screw it belongs to.

**Symptom** — the project assistant answers ordinary questions but every turn that
would add a part or write firmware fails with `AI_PROVIDER_ERROR` and an upstream
400 or 404, depending on which model the tier picked.
**Cause** — the tool request itself was rejected before any model saw it. Two fields
did it: `uniqueItems` on `add_device.wirePins`, which several OpenRouter providers
reject outright ("The `uniqueItems` JSON Schema keyword is not supported"), and an
explicit `tool_choice: 'auto'`, which makes OpenRouter drop every endpoint that does
not advertise `tool_choice` support and answer 404 "No endpoints found".
**Fix** — keep tool schemas to keywords every provider accepts and let `tool_choice`
default. Uniqueness of `wirePins` is enforced in `ai-tool-executor.ts`, where the
arguments are untrusted anyway. Check a new schema keyword against a small free model
before shipping it; the large ones accept more than the small ones do.

**Symptom** — a project turn that stages hardware ends in `AI_GENERATION_TIMEOUT`, or
the plan arrives with a wall of red warning text beside the accept button describing
a change that was in fact staged.
**Cause** — two separate defects with one look. The latency tier ran the tool loop: on
the free catalog its winner spends up to two minutes on a single round and a dozen
rounds outran the budget. And `add_device` reported the whole call refused when one
pin of `wirePins` could not be wired, so a successful add reached `plan.warnings`.
**Fix** — `ProjectAiService` floors the profile at `balanced`, and the IDE no longer
offers the tier it would ignore; `add_device` reports the device it staged and leaves
the per-pin refusal in the tool content, which is where the model reads and corrects
it. Do not try to separate fast models from slow ones with `supportsReasoning` —
every free model currently declares it, so a filter on it empties the candidate set.

**Symptom** — a turn ends with `An unexpected error occurred`, or leaving the IDE
while the assistant is working loses the answer and the panel is idle on return.
**Cause** — two things. A model round occasionally comes back with neither prose nor a
tool call, which was treated as fatal and threw away a nearly finished plan. And the
conversation lived in the IDE component, so navigating away destroyed it and dropped
the HTTP subscription with it.
**Fix** — the adapter retries one empty round before reporting `AI_PROVIDER_EMPTY`, and
the conversation lives in `project-ai-chat.store.ts`, an auto-provided service that
outlives any page. Keep it that way: state that must survive navigation does not belong
in a component, and the page keeps only what the page knows — the open file, what the
simulator reported, how to refresh the editor after an apply.

**Symptom** — a proposed circuit passes every wiring check and does not work: an LED
with a 220 Ω series resistor still runs at full current, or a pull-up has no effect.
**Cause** — the part is wired in series *and* jumped around, so both of its leads sit
on the same electrical node. Each wire is legal on its own, and the engine judges one
wire at a time, so nothing objected.
**Fix** — `bypassedCurrentLimiters` in `pin-assignment.ts` looks at the circuit as a
whole and `auditCircuit` reports `bypassed-current-limiter`; remove the wire that goes
around the part. When adding a rule of this shape, put it in the whole-circuit audit
rather than in `validateConnection` — a property of a node is not a property of a wire,
and checking it per wire reports it once per wire that touches the node.

## Repository

**Symptom** — the root repository will not track `frontend/` or `backend/`.
**Cause** — nested `.git` directories, no submodule or workspace configuration.
**Fix** — resolve the nesting before any branch strategy matters. See
`docs/LEGACY_AUDIT.md` § 1.
