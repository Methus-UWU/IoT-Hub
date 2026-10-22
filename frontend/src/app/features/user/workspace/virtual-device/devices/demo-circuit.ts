import type { DeviceKind } from '../device-library.models';
import type { ConnectionKind, WireConnection } from '../models/virtual-device.model';

/**
 * The starter circuit shown when the canvas is opened outside a project.
 *
 * It is demo content only: a real project loads its own components and clears
 * all of this before the first paint. Its instance ids are catalog ids because
 * the standalone canvas places exactly one of each part.
 *
 * The board it wires to is `esp32-devkit-38`, the same catalog part a user can
 * place themselves. Before this file existed the demo board was a second ESP32
 * drawn directly into the canvas template at fixed pixel coordinates, with its
 * own pin ids and its own wire endpoint type — a whole parallel code path that
 * could drift from the catalog and did.
 */

/** The demo board's catalog id, so the wires below name it in one place. */
export const DEMO_BOARD_ID: DeviceKind = 'esp32-devkit-38';

const WIRE_RED = '#ef4444';
const WIRE_BLACK = '#111827';
const WIRE_YELLOW = '#f59e0b';
const WIRE_BLUE = '#2563eb';
const WIRE_GREEN = '#22c55e';
const WIRE_PURPLE = '#a855f7';
const WIRE_CYAN = '#06b6d4';

function starterWire(
  id: string,
  deviceId: DeviceKind,
  devicePin: string,
  boardPin: string,
  color: string,
  kind: ConnectionKind,
): WireConnection {
  return {
    id,
    start: { type: 'device', deviceId, pinId: devicePin },
    end: { type: 'device', deviceId: DEMO_BOARD_ID, pinId: boardPin },
    waypoints: [],
    color,
    kind,
  };
}

/** The starter wiring shipped with a new virtual device workspace. */
export const INITIAL_CONNECTIONS: readonly WireConnection[] = [
  // VIN, not 3V3: the module is a 5 V HD44780 behind a backpack, and the panel
  // now stays dark below its own 4.7 V minimum rather than pretending to run.
  starterWire('lcd-vcc', 'lcd', 'VCC', 'VIN', WIRE_RED, 'power'),
  starterWire('lcd-gnd', 'lcd', 'GND', 'GND-R1', WIRE_BLACK, 'ground'),
  starterWire('lcd-sda', 'lcd', 'SDA', 'GPIO21', WIRE_BLUE, 'signal'),
  starterWire('lcd-scl', 'lcd', 'SCL', 'GPIO22', WIRE_YELLOW, 'signal'),
  starterWire('led-sig', 'led', 'A', 'GPIO26', WIRE_PURPLE, 'signal'),
  starterWire('led-gnd', 'led', 'K', 'GND-L', WIRE_BLACK, 'ground'),
  starterWire('sonar-vcc', 'ultrasonic', 'VCC', 'VIN', WIRE_RED, 'power'),
  starterWire('sonar-trig', 'ultrasonic', 'TRIG', 'GPIO5', WIRE_GREEN, 'signal'),
  starterWire('sonar-echo', 'ultrasonic', 'ECHO', 'GPIO18', WIRE_BLUE, 'signal'),
  starterWire('sonar-gnd', 'ultrasonic', 'GND', 'GND-R2', WIRE_BLACK, 'ground'),
  starterWire('relay-vcc', 'relay', 'VCC', 'VIN', WIRE_RED, 'power'),
  starterWire('relay-gnd', 'relay', 'GND', 'GND-L', WIRE_BLACK, 'ground'),
  starterWire('relay-in', 'relay', 'IN', 'GPIO27', WIRE_YELLOW, 'signal'),
  starterWire('button-sig', 'button', '1', 'GPIO4', WIRE_CYAN, 'signal'),
  starterWire('button-gnd', 'button', '3', 'GND-L', WIRE_BLACK, 'ground'),
  starterWire('servo-pwm', 'servo', 'PWM', 'GPIO13', WIRE_YELLOW, 'signal'),
  starterWire('servo-vcc', 'servo', 'VCC', 'VIN', WIRE_RED, 'power'),
  starterWire('servo-gnd', 'servo', 'GND', 'GND-R1', WIRE_BLACK, 'ground'),
];

/** Wire colours offered in the inspector, following common jumper conventions. */
export const WIRE_COLORS: readonly string[] = [
  WIRE_BLACK,
  WIRE_RED,
  WIRE_YELLOW,
  WIRE_GREEN,
  WIRE_BLUE,
  WIRE_CYAN,
  WIRE_PURPLE,
  '#f472b6',
];
