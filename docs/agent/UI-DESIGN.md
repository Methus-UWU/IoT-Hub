# UI Design — Modern Minimal

How pages should look and where the styling lives. `docs/CONVENTIONS.md` § "Shared
UI" governs *what* may be shared; this governs *how it looks*.

## Principles

- Content first. Chrome — borders, shadows, panels, badges — only where it separates
  two things the user must not confuse.
- One accent. Colour marks state (error, warning, active), never decoration.
- Space over lines. Prefer whitespace and alignment to dividers and boxes.
- One type scale, one radius scale, one shadow. If a page needs a fourth size, the
  page is wrong, not the scale.
- Motion under 200 ms, on entry and state change only. Nothing loops.
  Exception: the project generation waiting screen uses subtle, pausable circuit
  and indeterminate activity animations, as requested. They run only while work is
  active, honor `prefers-reduced-motion`, and never represent completion percentages.
- Density belongs to the surface: the IDE and canvas are dense tools; marketing,
  auth, and plan pages breathe.

## Tokens

Tokens live in `frontend/src/styles.css` under `@theme` (Tailwind 4). Today that
is the font stack plus `--color-primary`, `--color-primary-dark`,
`--color-primary-light`, `--color-error`.

- Add a token there before using a colour twice.
- Never write a hex literal in a component template or CSS file. If you need a value
  the tokens do not have, add the token.
- `styles.css` is ~1030 lines and holds page-specific escapes. Do not add to that
  habit: global CSS is for tokens, resets, and the few rules that must cross Angular
  style encapsulation (each such rule carries a comment saying why — keep that).

## Device artwork

Every microcontroller board, plus the PIR, LM35, push button, potentiometer, DC
motor, HC-05, and relay module illustrations, use the flat schematic reference:
navy or teal boards, blue controls, matte grey metal, dark plastic, and muted gold
contacts. Use `FLAT` or `WOKWI` in `device-palette.ts` and the shared flat drawings
in `device-parts.ts` — `flatBoard`, `flatHeader`, `flatChip`, `flatDipChip`,
`flatLed`, `flatButton`, `flatUsbConnector`, `flatMountingHole`. The Uno and the
Mega share `WOKWI.arduinoBoard`, so the two Arduino boards stay one colour.
Keep outlines, pin locations, and state cues; omit gradients, reflections, cast
shadows, and decorative surface grain.

Printed text never sits on another drawn part. Header pin names start 1.6 mm from
the header centre-line (half the 2.5 mm housing plus a gap), and the strip beside a
header belongs to those names — LEDs, buttons, and chips go inboard of it. Board
titles and section labels go on bare solder mask, clear of pin names. When checking
an overlap in the browser, compare against `getStartPositionOfChar`, not the text's
bounding box: the box reaches about 0.4 mm left of the first glyph. Artwork tokens live in the device palette
because hardware colors are theme-independent.

## Components

Reuse what exists in `shared/components/` before styling anything new:
`custom-select`, `date-range-picker`, `field-error`, `file-icon`, `line-chart`,
`metric-card`, `metric-icon`, `stat-card`, `status-badge`, `toast`.

If a page needs a dropdown, a badge, or a stat tile, it uses these. A second custom
dropdown implementation is a defect. If the shared component nearly fits, extend it
with an input rather than forking it.

The part inspector (`virtual-device/device-inspector/`) builds its controls from each
part's property definitions and picks the smallest control that fits: a segmented row
for up to four short options (LOW/HIGH, 3/5/12 V, 3/5/10 mm), swatches for colours, a
switch for booleans, a slider plus direct number input for bounded numbers, and
`custom-select` only for longer option lists. Typed numbers are clamped to the
declared bounds and normalised to the declared step. Settings sit apart from controls
that act only while the simulation runs. A part that is sold in variants with different pins (common-anode or
common-cathode RGB) declares `variants` and is switched in place rather than
re-placed. Add a knob to a part by declaring a property, not by editing the panel.

Missing from `shared/` and worth extracting the next time a second page needs one:
button, dialog/modal, table, pagination, tabs, tooltip, page header, empty state,
loading state. Extract on the second use, not in advance.

## States every screen owes the user

The admin shell owns the viewport height and scrolls only its positioned `main`.
Positioning keeps absolutely positioned accessibility labels inside that scroll
container instead of extending the document. The integrations page uses static,
section-shaped skeletons for settings, usage, and user selection, with
screen-reader loading messages. Completed data stays visible during background
refreshes; errors replace pending placeholders with a retry or inline error.

Integrations uses compact selects and 12px body text with 14px section headings.
Credit limits and reset schedules stack by period, with controls aligned within
each row on wider screens. Usage totals use compact label/value rows; loading
placeholders follow the same layout.

Loading, empty, error, and success. A page that only renders the happy path is not
finished. Use the shared loading and empty presentation once it exists; until then,
keep them plain and consistent with neighbouring pages.

The virtual-device load error stays inside the canvas row as a neutral, centered
message with a retry button and a link to the project's source code. Retry keeps
the message visible while loading and disables repeated requests. Canvas tools
and shortcuts remain inactive until a saved layout has loaded successfully.

## Accessibility floor

The Virtual Device Serial Monitor has a top resize separator with pointer capture
and keyboard controls (Up/Down, Home/End); double-click restores its default height.
`SerialMonitorResize` bounds its height to the canvas container, leaving canvas space
visible and adapting when the container resizes. Closing and reopening the monitor
preserves its height within the page. Clear output and Close have separate, labeled
buttons; closing the panel does not stop simulation or clear its output.

The IDE assistant uses one `AiAssistantAvatar` and the `IoT Hub AI` name in its
header and replies. Its header keeps the current conversation visible through
`custom-select`, with update dates and a selected indicator in the list. A separate
New chat action stays visible without opening the list. Session selection inherits
the shared select's keyboard navigation, Escape, and outside-click handling.

Assistant Markdown code blocks use light surface and ink tokens. Enter and the
Send button accept the current draft immediately, clear the composer, and lock the
turn before collecting optional diagnostics. Shift+Enter inserts a newline; IME
composition and repeated keydown events do not submit another turn.

Focus is always visible. Interactive elements are real buttons and links. Contrast
at least 4.5:1 for text. Icons that carry meaning get a label. Forms use Reactive
Forms with `field-error`, so the error text and the invalid state come from one place.

## Charts

Load the `dataviz` skill before writing any chart, dashboard tile, or sparkline, and
reuse `line-chart` / `metric-card` rather than starting a new chart implementation.

## Before you call a page redesigned

- No hex literal outside `styles.css`.
- No duplicated component that `shared/` already provides.
- Loading, empty, and error states exist.
- Keyboard reaches every action, and focus is visible.
- The page still looks like its neighbours.
