# ADR-005: Firmware Simulation on the Canvas

- Status: **Accepted — implemented**
- Date: 2026-09-08
- Related: `docs/adr/ADR-002-build-isolation.md`, `docs/agent/PAGE-INVENTORY.md`

## Context

The virtual workspace already had a real circuit solver: a node-voltage model that
rebuilds nets every tick, resolves drivers by strength, and reports shorts. Sixteen
parts had behaviours — an LED computed brightness from the voltage across it, a
relay energised its coil and bonded `COM` to `NO`, a button merged two nets when
closed.

What it could not do was run the user's code. `circuit-simulator.ts` left every
board signal pin floating, with the comment that stated the reason plainly:

> Signal pins stay floating: without executing firmware there is nothing to say
> what a GPIO is doing, and inventing a level is a lie.

So a user could wire a button straight to a relay and watch it work, but the
sketch they wrote in the IDE — `digitalWrite(RELAY_PIN, LOW)` — had no effect on
anything. For a teaching tool, that is the wrong half to be missing.

Compiling the sketch was not available as a route. ADR-002 disabled server-side
PlatformIO builds because they were remote code execution against a process
holding every platform secret, and the replacement is a Phase 4 queued worker
that does not exist yet.

## Decision

Interpret a subset of Arduino C++ in the browser, and let the interpreter drive
board pins through the existing behaviour contract.

Three options were considered.

**A full emulator (avr8js or similar).** Cycle-accurate, and wrong here: it needs
a compiled binary, which needs the build pipeline ADR-002 removed. It would also
only cover AVR, leaving the ESP32 boards — the ones this platform is actually
about — unsupported.

**Waiting for the Phase 4 build worker.** Correct eventually, but it produces a
binary for real hardware, not something the canvas can step. Even with it, the
canvas would still need an execution engine.

**A subset interpreter, chosen.** No build step, no server involvement, works for
every board in the catalog because pin numbers resolve against the catalog's own
pin names. It runs a sketch's control flow and pin operations, which is what the
circuit needs, and refuses everything else with a line number.

## Consequences

The engine is a lexer, a recursive-descent parser, and a resumable interpreter,
under `virtual-device/simulation/firmware/`. Three constraints shaped it.

**Execution must be resumable.** The solver ticks at 20 Hz on the UI thread and a
sketch calling `delay(1000)` must not block it. The interpreter is written as
generators that yield between statements; `delay()` yields a duration and the
machine refuses to resume until its virtual clock passes it. The same mechanism
contains `while (true) {}` — it burns a per-tick step budget and returns, so the
tab stays alive.

**The sketch runs once per tick, not once per drive pass.** The solver's
relaxation loop calls `drive()` three times per tick. Running the sketch there
would make `millis()` advance at a rate depending on how hard the solver worked,
so the sketch executes in `update()` against the nodes the previous pass
resolved, and the levels it produced are replayed on each drive pass. Pin changes
land one tick — 50 ms of simulated time — after the sketch writes them, which no
sketch can observe.

**A pin is driven only when the sketch says so.** The floating-pin rule the
original comment defends still holds: a pin is driven if and only if the sketch
configured it as an output or a pull-up. `INPUT_PULLUP` drives weakly, which is
exactly what lets a button to ground read LOW while an open button reads HIGH.

`DeviceBehaviorFactory` now receives the placed instance id, because a board must
find the sketch running on *it* — a diagram may hold two boards. Every other part
ignores the argument.

### What this is not

The VM has one numeric type, but a variable declared with an integer type
(`int`, `long`, `uint32_t`, …) truncates what is stored in it, and `map()`
divides as integers. Before this, a sketch showed `Soil: 20.28%` from an `int`
that prints `20` on the board. That difference shows on every display, so
it had to go. Overflow is still not modelled, and neither are function return
and parameter types.

**PWM carries its duty.** `analogWrite` drives the pin's *average* voltage, which
is what a meter or an ADC reads, and the node also carries the duty it is high
for. An LED uses both: it lights from the peak (`voltage / duty`) and scales its
brightness by the duty, so `analogWrite(pin, 64)` glows at a quarter instead of
staying dark because 0.8 V sits below its forward voltage. A pin that sinks an
LED's cathode lights it for the low part of each period instead.

**Parts need their own power.** A sensor module, relay, or display is not a
signal source: `requiresSupply` in `device-simulation.ts` wraps a part's
behaviour so it only drives outputs while its own VCC and GND reach a supply at
its minimum voltage, and every tick it publishes `powered`. Artwork lights power
lamps, heater glows, and echo cones from `powered`, never from the Start button,
so a module with no wires stays dark and its outputs float. Minimums follow the
parts — an LM35 or a PIR on a 3.3 V rail genuinely stays dead.

**VCC and GND must reach the same supply.** Every node records which supplies'
rails reach it — a board or battery by instance id, the schematic VCC and GND
symbols as one shared `supplyGroup`. `supplyVolts` returns 0 when a part's supply
and ground pins name no supply in common, so a sensor fed from a board's 3V3 but
grounded only on a GND symbol stays dead, as it would with no return path on a
bench. Wiring the board's GND to a GND symbol puts both supplies on that ground
net, which is a common ground and powers it again. Relays, the pump, the DC motor
and the buzzer apply the same rule, and the wiring check reports the split as
`split-supply`. Nodes driven only by non-supply parts name no supply and are not
judged.

**Actuators animate from the circuit.** The DC motor reads the voltage across
its tabs: below 1.5 V, or stalled, it holds still; otherwise it advances a shaft
angle each tick, signed by polarity, and its propeller is drawn from that angle.
The water pump advances a water phase only while pumping. Neither moves when the
simulation merely runs with nothing powering it.

**A short stops the run.** When the solver finds two strong drivers disagreeing
on a node — a rail bridged to ground, a GPIO driven HIGH into GND — the canvas
stops the simulation the way a bench supply's fuse would. The finding stays where
every wiring finding appears: the wires on that node are dashed, and it is listed
in the issue list and the part's inspector until the next Start.

**A running circuit is locked except for part settings.** Adding, removing, or
rotating a part and deleting a wire are disabled until Stop. Only the inspector's
property controls stay live, and those are what a user turns to see the circuit
react.

**Common libraries are emulated at the level a sketch observes.** The catalog's
smart parts, such as a DHT22, an SSD1306 or a servo, cannot be modelled bit by bit
on a 20 Hz tick, so what passes between them is carried whole on the wire as a
`BusMessage`. Each part publishes on its own pin during `drive`:
- a DHT22 publishes its reading,
- an OLED announces its I2C address on SDA.

The library emulations under `firmware/libraries/` are the sketch's half:
- `dht.readTemperature()` returns what the part on that pin published, or NaN if
  nothing answers;
- `display.begin()` is false unless a powered OLED at that address sits on the
  board's SDA;
- `display.display()` publishes the frame, and the OLED draws it.

Only parts that share a node see each other, so wiring still decides who can
talk. The emulated libraries are Wire, DHT, Adafruit_SSD1306 (text on the real 128×64 grid, cut at the panel edge; shapes
are accepted but not drawn), LiquidCrystal_I2C (addressed, so two displays share a bus), `tone()` and ESP32 LEDC channels, Servo/ESP32Servo, and
OneWire + DallasTemperature. The language grew what those sketches need:
- objects built with arguments;
- `enum` and `switch`;
- `&` and `*` as no-ops;
- reference parameters on functions, constructors, and methods alias caller
  variables or array elements, so helpers such as `colorWheel(pos, r, g, b)`
  actually return their channel values;
- `sizeof` for supported scalar types, declared one-dimensional arrays, and
  array elements, without evaluating the operand. AVR int sizes are 2 bytes;
  ESP32 int sizes are 4 bytes. Unsupported size expressions report a runtime
  fault rather than guessing;
- `F()`, `NAN`/`isnan`, and `Serial.printf`.
- Arduino `String` methods used by typical sketches, including trim, substring,
  numeric conversion, search, and case conversion;
- data-oriented structs and classes with fields, constructors, methods, and
  inferred template functions. Inheritance, virtual dispatch, overload
  resolution, and explicit template specialization remain outside the VM;
- edge-triggered `attachInterrupt` callbacks for CHANGE, RISING, and FALLING;
- sandboxed ESP32 WiFi and HTTPClient APIs. WiFi reports a virtual connection so
  setup code can continue, while HTTP calls return `-1` and never send data.

`library-catalog.ts` states which library drives which part, and the exporter
hands it to the API, so the assistant writes against the libraries the canvas
runs. A library object the simulator does not emulate is reported by class name.
Other members of `Serial` still do nothing.

Timing is virtual and coarse. `millis()` advances by the real frame delta, so it
tracks wall clock roughly but not precisely, and `delayMicroseconds()` cannot
resolve below the 50 ms tick.

The firmware loader publishes runtime faults on each simulation tick, as well as
initial parse errors. The canvas toolbar therefore shows the failing source line
when a sketch stops after setup instead of continuing to claim it is running.
Pending source reads are scoped to a run number. Stop, navigation, and a new
Start invalidate the old run, so a delayed response cannot attach firmware or
overwrite a newer run's error state. `verify-firmware-loader` exercises these
races alongside missing-board, missing-source, network, and compile failures.

## Verification

The peripheral expansion and current test commands are recorded in
[Peripheral simulation verification](../agent/PERIPHERAL-VERIFICATION.md).
`frontend/examples/` contains five executable circuit/sketch fixtures.

`frontend/scripts/verify-firmware.ts` builds real circuits from catalog parts,
runs the real solver, and asserts on resolved node voltages — nothing is stubbed.
105 checks cover: the emulated libraries (DHT, SSD1306, LCD I2C, Servo, DS18B20) reading and writing real parts on the canvas; `digitalWrite` driving a pin; the button → sketch → relay → LED
chain end to end; `delay()` timing across ticks; `analogWrite` landing between the
rails; `analogRead` seeing a real node; compile and runtime faults reported with
line numbers; a runaway loop returning rather than hanging; Arduino pin numbering;
serial capture, including the rate the sketch opened the port at; PWM dimming an
LED in proportion to 0–255, from the anode or
the cathode, on single and RGB LEDs; parts staying dead when their VCC and GND
reach different supplies, until a common ground joins them; and inspector settings
acting on the circuit — a relay set to trigger on HIGH, and a pump or motor rated
3, 5 or 12 V that will not start below half its rating and is flagged above it.
