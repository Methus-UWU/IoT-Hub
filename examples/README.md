# Peripheral project examples

Each directory contains a complete `main.ino` and a `circuit.json` wiring recipe.
The recipes are simulator fixtures, not the application's project-import format.
They create no database records and make no AI requests.

| Example | Parts | Interaction |
| --- | --- | --- |
| `ir-counter` | FC-51 IR + TM1637 | Move distance below the trigger range; one count per approach |
| `rtc-clock` | DS1307 + TM1637 | Shows 12:34 after setup; seconds advance on Serial |
| `weather-lcd` | BME280 + LCD 1602 I2C | Adjust temperature, humidity and pressure in the inspector |
| `rfid-matrix` | RC522 + MAX7219 8x8 | Present a card; Serial prints UID and the top matrix row lights |
| `touch-panel` | ILI9341 + XPT2046 | Set touched and raw X/Y in the inspector; TFT prints coordinates |

To run on the canvas, create an ESP32 DevKit V1 project, place the listed devices,
and connect the wires from its recipe. A wire tuple is
`[sourceInstanceId, sourcePin, targetInstanceId, targetPin]`; instance ids identify
parts in the recipe, not database ids. Copy `main.ino` into the project editor and
start simulation. `VIN` on this simulated development board supplies USB 5 V.
Use the inspector controls while running. RFID HaltA requires removing and
presenting the card again before another scan. The matrix intentionally retains
its indication after scanning.

The device documentation page includes pin guidance and the supported Arduino API
for each module. The library catalog supplies the corresponding PlatformIO
dependencies; these examples are interpreted, not compiled to physical firmware.

Run all frontend verification from `frontend` with `npm test` (`npm.cmd test` in
restricted Windows PowerShell). The runner bundles each existing verification
script and the example tests using the installed esbuild package, records logs in
`.tmp/verification`, and exits nonzero if any suite fails. From the repository
root, `npm test` runs backend unit tests followed by frontend verification.

The examples use the real catalog, firmware VM and circuit solver. Tests change
inspector values and remove each important power/data/clock/select connection.
These checks do not verify browser interaction, authenticated persistence, live
Supabase, AI-provider calls, electrical timing or hardware compilation.

Simulation limits: TFT is a portrait text preview with size-1 text and a single
foreground color; touch comes from inspector controls. MAX7219 supports one
module per pin set. RFID supports presence and four-byte UIDs, without sector
security or writes. DS1307 runs a virtual UTC clock with no battery persistence.
BME280 uses inspector readings without calibration or sampling timing. Unknown
methods fail explicitly. Review module-specific voltage and level-shifting
guidance before adapting these simulated circuits to real hardware.
