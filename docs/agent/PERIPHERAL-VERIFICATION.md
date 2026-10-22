# Peripheral simulation verification

The 2026-09-26 expansion adds MAX7219 8x8, TM1637, DS1307, RC522, ILI9341 with
XPT2046, and BME280. Existing LCD and FC-51 IR parts are reused. Device definitions
remain the source of truth; catalog and datasheets are exported to the backend.

`frontend/examples/README.md` describes five reproducible projects. Each test
loads the actual `.ino` and `circuit.json`, runs the firmware interpreter and node
solver, and checks observable output. No provider or persistence mock is involved
because these projects operate entirely in the simulator.

New buses publish named roles on all required signal nodes. A receiver accepts a
frame only if all roles come from the same source and bus key. This catches missing
or swapped clock/data/select wires and prevents one sender completing another
sender's incomplete circuit. I2C addresses distinguish BME280 instances. Power is
checked with the existing `requiresSupply` wrapper. Timing remains coarse, as in
ADR-005; these protocols do not emulate individual clock edges.

Firmware changes add default SPI metadata, `SPI.begin(sck, miso, mosi)` remapping,
numeric DateTime construction, and explicitly exported read-only library fields
for `point.x` and `reader.uid.uidByte[i]`. Field reads never reflect JavaScript
properties. Unsupported methods and fields produce a firmware fault.

Verification entry points:

- Repository root `npm test`: backend unit tests and all frontend verification.
- `frontend/npm test`: catalog, firmware, layout, relay and example suites.
- Both subprojects `npm run build`: production builds and application type checks.
- `backend/npm run test:e2e`: separate full application boot smoke test; requires
  the database and the Prisma/Jest ESM runtime. It is not part of the offline suite.

The catalog verifier also enforces the safety contract across the whole library:
every pin has electrical type/direction metadata, every catalog id has a substantial
datasheet, datasheets cannot point to deleted parts, and every library-driven device
has a simulator behavior. Circuit diagnostics now report a partly wired device with
missing VCC/GND, an incomplete SDA/SCL pair, and duplicate I2C addresses on one bus.
They also report shared SPI chip-select lines, UART TX/TX or RX/RX wiring, unsafe
logic-level input voltage, declared supply-current overload, and missing external
pull-up or pull-down resistors. The electrical metadata is exported to the API so
AI wiring plans and hand-drawn circuits use the same catalog facts.

The browser workflow is covered by Playwright: an authenticated IDE turn asks the
assistant to read a datasheet, previews and applies an add/wire plan, starts the
simulator, and reloads the saved component and wire state. Run it with
`frontend/npm run test:e2e`; it serves the production build and mocks only the
authorized API boundary.

The old catalog verifier had drifted from production: deleted board import,
obsolete board endpoints, potentiometer percentage settings, and unpowered PIR
fixtures. These now use actual catalog boards, current wiper counts, and supply
wires. The restored geometry checks exposed a WROOM pad outside the body and LM35
pin hit areas overlapping; both geometry definitions were corrected. The backend
admin authorization test now retains JOSE error classes and throws a real invalid
signature error in its mock.

See [ADR-005](../adr/ADR-005-firmware-simulation.md) for the interpreter boundary,
and each device's user documentation for intentionally unsupported behavior.
