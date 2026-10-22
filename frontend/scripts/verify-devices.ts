/**
 * Device catalog verification.
 *
 * The project has no unit-test runner yet (see `angular.json` — there is no
 * `test` target and neither karma nor vitest is installed), so this script is
 * the stand-in: it bundles the catalog with esbuild and runs it on Node, which
 * exercises the registry guards, every part's `draw()`, and the pure physics
 * helpers without needing a DOM.
 *
 * Run it from `frontend/`:
 *
 *   node_modules/@esbuild/win32-x64/esbuild.exe scripts/verify-devices.ts \
 *     --bundle --platform=node --format=cjs --outfile=.tmp/verify.cjs \
 *     && node .tmp/verify.cjs
 *
 * On other platforms swap the esbuild binary path (`node_modules/.bin/esbuild`).
 *
 * When a real test runner is added, port each `eq(...)` below into a `.spec.ts`
 * and delete this file.
 */

import { deviceBadges, deviceInterfaces } from '../src/app/features/user/workspace/virtual-device/devices/core/device-registry';
import { aspectRatioMismatch } from '../src/app/features/user/workspace/virtual-device/devices/core/device-metrics';
import { defaultStateFor } from '../src/app/features/user/workspace/virtual-device/devices/core/device-definition';
import { rotatedPinOffset } from '../src/app/features/user/workspace/virtual-device/devices/core/device-pin';
import { rect, shapesForDetail } from '../src/app/features/user/workspace/virtual-device/devices/core/device-shape';
import {
  connectionKindForPinType,
  interfacesForPinTypes,
} from '../src/app/features/user/workspace/virtual-device/devices/core/device-types';
import { mixRgb } from '../src/app/features/user/workspace/virtual-device/devices/basic/rgb-led.device';
import { DEVICES, deviceById } from '../src/app/features/user/workspace/virtual-device/devices/device-catalog';
import { DEVICE_DATASHEETS } from '../src/app/features/user/documents/device-datasheets';
import { LIBRARY_CATALOG } from '../src/app/features/user/workspace/virtual-device/simulation/firmware/libraries/library-catalog';
import { wiperResistance } from '../src/app/features/user/workspace/virtual-device/devices/input/potentiometer.device';
import {
  formatResistance,
  resistorBands,
} from '../src/app/features/user/workspace/virtual-device/devices/passive/resistor.device';
import { breadboardNode } from '../src/app/features/user/workspace/virtual-device/devices/prototyping/breadboard.device';
import { ldrResistance } from '../src/app/features/user/workspace/virtual-device/devices/sensors/ldr.device';
import { ledBrightness } from '../src/app/features/user/workspace/virtual-device/devices/basic/led.device';
import { contactClosed } from '../src/app/features/user/workspace/virtual-device/devices/input/push-button.device';
const boardDevice = { instanceId: 'board', definition: deviceById('esp32-devkit-v1')!, properties: {} };
import type { DeviceBehavior } from '../src/app/features/user/workspace/virtual-device/devices/core/device-simulation';
import type { WireConnection } from '../src/app/features/user/workspace/virtual-device/models/virtual-device.model';
import { devicePinKey, simulateTick, type SimulationResult, type SimulatedDevice } from '../src/app/features/user/workspace/virtual-device/simulation/circuit-simulator';
import { validateCircuit } from '../src/app/features/user/workspace/virtual-device/simulation/wire-validation';

let pass = 0;
let fail = 0;

function eq(name: string, got: unknown, want: unknown): void {
  const gotJson = JSON.stringify(got);
  const wantJson = JSON.stringify(want);
  if (gotJson === wantJson) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}: got ${gotJson} want ${wantJson}`);
  }
}

// --- every registered part must draw at every detail level -----------------
// Importing the catalog already runs the registry's duplicate-id and
// duplicate-pin guards, so a clash fails the script before we get here.
let shapeRendered = 0;
let legacyArt = 0;
for (const device of DEVICES) {
  if (!device.render) {
    legacyArt++;
    continue;
  }
  const state = defaultStateFor(device.properties);
  for (const detail of ['low', 'normal', 'high'] as const) {
    const shapes = shapesForDetail(device.render.draw({ state, detail, running: true }), detail);
    eq(`${device.id} draws at ${detail}`, shapes.length > 0, true);
  }
  for (const devicePin of device.pins) {
    eq(
      `${device.id}:${devicePin.name} has finite coords`,
      Number.isFinite(devicePin.x) && Number.isFinite(devicePin.y),
      true,
    );
  }
  shapeRendered++;
}

// --- resistor colour bands -------------------------------------------------
eq('220R bands', resistorBands(220), { first: 2, second: 2, exponent: 1 });
eq('4k7 bands', resistorBands(4700), { first: 4, second: 7, exponent: 2 });
eq('1M bands', resistorBands(1_000_000), { first: 1, second: 0, exponent: 5 });
eq('4R7 uses gold multiplier', resistorBands(4.7), { first: 4, second: 7, exponent: -1 });
eq('format 4700', formatResistance(4700), '4.7 kΩ');
eq('format 220', formatResistance(220), '220 Ω');
eq('format 1e6', formatResistance(1_000_000), '1 MΩ');

// --- LDR response curve ----------------------------------------------------
eq('LDR hits its reference point', Math.round(ldrResistance(10)), 10_000);
eq(
  'LDR resistance falls as light rises',
  ldrResistance(1) > ldrResistance(10) && ldrResistance(10) > ldrResistance(1000),
  true,
);

// --- RGB mixing keeps hue while dimming ------------------------------------
eq('rgb off', mixRgb(0, 0, 0).level, 0);
eq('rgb full red', mixRgb(255, 0, 0).color, 'rgb(255, 0, 0)');
eq('rgb dim red keeps hue', mixRgb(64, 0, 0).color, 'rgb(255, 0, 0)');
eq('rgb dim red drops level', Math.round(mixRgb(64, 0, 0).level * 100) / 100, 0.25);

// --- potentiometer taper ---------------------------------------------------
eq('linear midpoint', wiperResistance(10_000, 2047.5, 'linear'), 5000);
eq('log taper sits lower at midpoint', wiperResistance(10_000, 2047.5, 'log') < 5000, true);
eq('travel clamps above 4095 counts', wiperResistance(10_000, 5000, 'linear'), 10_000);

// --- breadboard internal nets ----------------------------------------------
eq('A1 and E1 share a strip', breadboardNode('A1'), breadboardNode('E1'));
eq('ravine isolates A1 from F1', breadboardNode('A1') === breadboardNode('F1'), false);
eq('columns are independent', breadboardNode('A1') === breadboardNode('A2'), false);
eq('a rail runs the whole board', breadboardNode('T+1'), breadboardNode('T+30'));
eq('plus and minus rails differ', breadboardNode('T+1') === breadboardNode('T-1'), false);

// --- detail budget ---------------------------------------------------------
const sample = [
  rect(0, 0, 1, 1),
  rect(0, 0, 1, 1, { detail: 'normal' }),
  rect(0, 0, 1, 1, { detail: 'high' }),
];
eq('low keeps only always-draw shapes', shapesForDetail(sample, 'low').length, 1);
eq('normal keeps two', shapesForDetail(sample, 'normal').length, 2);
eq('high keeps all', shapesForDetail(sample, 'high').length, 3);

// --- rotation keeps pins glued to the artwork ------------------------------
const body = { width: 100, height: 40 };
eq('rotation 0 is identity', rotatedPinOffset(body, { x: 0, y: 20 }, 0), { x: 0, y: 20 });
const turned = rotatedPinOffset(body, { x: 0, y: 20 }, 90);
eq('rotation 90', { x: Math.round(turned.x), y: Math.round(turned.y) }, { x: 50, y: -30 });
eq('rotation 360 round-trips', rotatedPinOffset(body, { x: 0, y: 20 }, 360).x, 0);

// --- pin type collapses to the wiring kind ---------------------------------
eq('vcc is power', connectionKindForPinType('vcc'), 'power');
eq('gnd is ground', connectionKindForPinType('gnd'), 'ground');
eq('pwm is signal', connectionKindForPinType('pwm'), 'signal');
eq('sda + scl imply I2C', interfacesForPinTypes(['i2c-sda', 'i2c-scl', 'vcc']), ['i2c']);

// --- catalog integrity -----------------------------------------------------
const ids = DEVICES.map((device) => device.id);
eq('device ids are unique', new Set(ids).size, ids.length);
eq('every part has pins', DEVICES.every((device) => device.pins.length > 0), true);
eq('every part has tags', DEVICES.every((device) => device.catalog.tags.length > 0), true);
eq(
  'every pin has electrical type and direction metadata',
  DEVICES.every((device) =>
    device.pins.every((pin) => Boolean(pin.type) && Boolean(pin.direction)),
  ),
  true,
);
eq(
  'every catalog part has a substantial datasheet',
  DEVICES.every((device) => (DEVICE_DATASHEETS[device.id]?.trim().length ?? 0) >= 200),
  true,
);
eq(
  'datasheets do not name deleted catalog parts',
  Object.keys(DEVICE_DATASHEETS).every((id) => Boolean(deviceById(id))),
  true,
);
const libraryDeviceIds = LIBRARY_CATALOG.flatMap((library) => library.devices);
eq(
  'library references name existing catalog parts',
  libraryDeviceIds.every((id) => Boolean(deviceById(id))),
  true,
);
eq(
  'every library-driven part has a simulator behavior',
  libraryDeviceIds.every((id) => Boolean(deviceById(id)?.simulation)),
  true,
);
eq(
  'library references have no duplicate device within one library',
  LIBRARY_CATALOG.every(
    (library) => new Set(library.devices).size === library.devices.length,
  ),
  true,
);
eq('OLED advertises I2C', deviceBadges(deviceById('oled-096-i2c')!).includes('I2C'), true);
eq('DHT22 advertises 1-Wire', deviceInterfaces(deviceById('dht22')!).includes('onewire'), true);
eq(
  'Uno keeps its three GND pins distinct',
  deviceById('arduino-uno-r3')!.pins.filter((devicePin) => devicePin.name.startsWith('GND')).length,
  3,
);
eq('Uno exposes 32 pins', deviceById('arduino-uno-r3')!.pins.length, 32);


// ---------------------------------------------------------------------------
// Simulation: a real circuit, solved end to end.
//
// 3V3 rail → button → LED anode, LED cathode → GND. Pressing the button must
// complete the loop and light the LED; releasing it must leave the LED's anode
// floating and the LED dark.
// ---------------------------------------------------------------------------

function buildCircuit(pressed: boolean): SimulationResult {
  const button = deviceById('button')!;
  const led = deviceById('led')!;

  const devices: SimulatedDevice[] = [
    boardDevice,
    { instanceId: 'btn', definition: button, properties: { pressed, mode: 'no' } },
    { instanceId: 'led1', definition: led, properties: { color: 'red' } },
  ];

  const behaviors = new Map<string, DeviceBehavior>();
  for (const device of devices) {
    const factory = device.definition.simulation;
    if (factory) behaviors.set(device.instanceId, factory(device.instanceId));
  }

  const wire = (
    id: string,
    start: WireConnection['start'],
    end: WireConnection['end'],
  ): WireConnection => ({ id, start, end, waypoints: [], color: '#000', kind: 'signal' });

  return simulateTick(
    {
      devices,
      connections: [
        wire('w1', { type: 'device', deviceId: 'board', pinId: '3V3' }, { type: 'device', deviceId: 'btn', pinId: '1' }),
        wire('w2', { type: 'device', deviceId: 'btn', pinId: '3' }, { type: 'device', deviceId: 'led1', pinId: 'A' }),
        wire('w3', { type: 'device', deviceId: 'led1', pinId: 'K' }, { type: 'device', deviceId: 'board', pinId: 'GND-L' }),
      ],
      deltaMs: 16,
    },
    behaviors,
  );
}

const released = buildCircuit(false);
const pressedResult = buildCircuit(true);

eq('LED dark while button released', released.runtime['led1']?.['brightness'], 0);
eq('LED lit while button pressed', (pressedResult.runtime['led1']?.['brightness'] as number) > 0, true);
eq('button reports closed when pressed', pressedResult.runtime['btn']?.['closed'], true);
eq('button reports open when released', released.runtime['btn']?.['closed'], false);
eq('no shorts in a healthy circuit', pressedResult.shorts.length, 0);

// The anode really is floating when the contact is open — not merely 0 V.
eq(
  'anode floats with the button open',
  released.pinStates.get(devicePinKey('led1', 'A'))?.floating,
  true,
);
eq(
  'anode sits at 3V3 with the button closed',
  pressedResult.pinStates.get(devicePinKey('led1', 'A'))?.voltage,
  3.3,
);

// LED forward-voltage model
eq('red LED dark below Vf', ledBrightness(1.5, 1.8), 0);
eq('red LED lights above Vf', ledBrightness(3.3, 1.8) > 0, true);
eq('blue LED stays dark on 3.3 V minus drop', ledBrightness(3.0, 3.0), 0);

// A reversed LED must not light.
eq('reverse bias stays dark', ledBrightness(-3.3, 1.8), 0);

// Contact modes
eq('NO closes when pressed', contactClosed(true, 'no'), true);
eq('NC opens when pressed', contactClosed(true, 'nc'), false);
eq('NC conducts at rest', contactClosed(false, 'nc'), true);

// ---------------------------------------------------------------------------
// Wiring validation
// ---------------------------------------------------------------------------

function vWire(id: string, start: WireConnection['start'], end: WireConnection['end']): WireConnection {
  return { id, start, end, waypoints: [], color: '#000', kind: 'signal' };
}

function validate(
  devices: readonly { instanceId: string; definition: ReturnType<typeof deviceById> }[],
  connections: readonly WireConnection[],
) {
  return validateCircuit({
    devices: [boardDevice, ...devices.map((d) => ({ instanceId: d.instanceId, definition: d.definition! }))],
    connections,
  });
}

const oled = deviceById('oled-096-i2c')!;
const dht = deviceById('dht22')!;
const pir = deviceById('pir-hc-sr501')!;

// A synthetic 3.3 V-only part. No catalog part is 3.3 V-max today — the OLED and
// DHT modules both carry regulators and tolerate 5 V — so proving this rule
// fires needs a part built for the purpose.
const strictPart = {
  ...oled,
  id: 'test-3v3-only',
  operatingVoltage: { min: 3.0, max: 3.6, recommended: 3.3 },
};

// 1. 5 V rail into a 3.3 V-max part → overvoltage warning.
const over = validate(
  [{ instanceId: 'o1', definition: strictPart }],
  [vWire('w', { type: 'device', deviceId: 'board', pinId: 'VIN' }, { type: 'device', deviceId: 'o1', pinId: 'VCC' })],
);
eq('5V into a 3.3V part warns', over.some((i) => i.code === 'overvoltage'), true);
eq('overvoltage is a warning, not an error',
   over.find((i) => i.code === 'overvoltage')?.severity, 'warning');

// 2. Same part on the 3V3 rail → clean.
const ok = validate(
  [{ instanceId: 'o1', definition: strictPart }],
  [vWire('w', { type: 'device', deviceId: 'board', pinId: '3V3' }, { type: 'device', deviceId: 'o1', pinId: 'VCC' })],
);
eq('3V3 into a 3.3V part is clean', ok.filter((i) => i.code === 'overvoltage').length, 0);

// 3. Parts rated to 5 V must NOT warn on the 5 V rail. Both of these modules
// carry an onboard regulator, so flagging them would be a false alarm — and a
// validator that cries wolf is one users learn to ignore.
const oled5v = validate(
  [{ instanceId: 'o1', definition: oled }],
  [vWire('w', { type: 'device', deviceId: 'board', pinId: 'VIN' }, { type: 'device', deviceId: 'o1', pinId: 'VCC' })],
);
eq('5V into the 5V-rated OLED is fine', oled5v.filter((i) => i.code === 'overvoltage').length, 0);
const dht5v = validate(
  [{ instanceId: 'd1', definition: dht }],
  [vWire('w', { type: 'device', deviceId: 'board', pinId: 'VIN' }, { type: 'device', deviceId: 'd1', pinId: 'VCC' })],
);
eq('5V into DHT22 is fine', dht5v.filter((i) => i.code === 'overvoltage').length, 0);

// 4. VCC wired straight to GND → short.
const shorted = validate(
  [{ instanceId: 'd1', definition: dht }],
  [vWire('w', { type: 'device', deviceId: 'd1', pinId: 'VCC' }, { type: 'device', deviceId: 'd1', pinId: 'GND' })],
);
eq('VCC to GND is a short', shorted.some((i) => i.code === 'power-ground-short'), true);
eq('short is an error', shorted.find((i) => i.code === 'power-ground-short')?.severity, 'error');

// 5. Two outputs on one net → conflict.
const twoOut = validate(
  [
    { instanceId: 'p1', definition: pir },
    { instanceId: 'p2', definition: pir },
  ],
  [vWire('w', { type: 'device', deviceId: 'p1', pinId: 'OUT' }, { type: 'device', deviceId: 'p2', pinId: 'OUT' })],
);
eq('two OUT pins conflict', twoOut.some((i) => i.code === 'output-conflict'), true);

// 6. One output into one input → clean.
const oneOut = validate(
  [
    { instanceId: 'p1', definition: pir },
    { instanceId: 'd1', definition: dht },
  ],
  [vWire('w', { type: 'device', deviceId: 'p1', pinId: 'OUT' }, { type: 'device', deviceId: 'd1', pinId: 'DATA' })],
);
eq('OUT into DATA is clean', oneOut.filter((i) => i.code === 'output-conflict').length, 0);

// 7. Unconnected parts produce nothing.
eq('no wires, no findings', validate([{ instanceId: 'd1', definition: dht }], []).length, 0);

// A user who starts wiring a module but omits power or half of its bus gets a
// concrete diagnosis instead of a display that silently stays blank.
const partialOled = validate(
  [{ instanceId: 'o1', definition: oled }],
  [vWire('w', { type: 'device', deviceId: 'board', pinId: 'GPIO21' }, { type: 'device', deviceId: 'o1', pinId: 'SDA' })],
);
eq('partly wired OLED reports missing power', partialOled.some((i) => i.code === 'missing-required-power'), true);
eq('partly wired OLED reports missing SCL', partialOled.some((i) => i.code === 'incomplete-i2c'), true);

const duplicateI2cAddress = validate(
  [
    { instanceId: 'o1', definition: oled },
    { instanceId: 'o2', definition: oled },
  ],
  [
    vWire('sda1', { type: 'device', deviceId: 'board', pinId: 'GPIO21' }, { type: 'device', deviceId: 'o1', pinId: 'SDA' }),
    vWire('scl1', { type: 'device', deviceId: 'board', pinId: 'GPIO22' }, { type: 'device', deviceId: 'o1', pinId: 'SCL' }),
    vWire('sda2', { type: 'device', deviceId: 'board', pinId: 'GPIO21' }, { type: 'device', deviceId: 'o2', pinId: 'SDA' }),
    vWire('scl2', { type: 'device', deviceId: 'board', pinId: 'GPIO22' }, { type: 'device', deviceId: 'o2', pinId: 'SCL' }),
  ],
);
eq('duplicate I2C address on one bus is an error', duplicateI2cAddress.some((i) => i.code === 'i2c-address-conflict' && i.severity === 'error'), true);

// 8. Findings carry a stable id (so dismissing one makes it stay dismissed).
const again = validate(
  [{ instanceId: 'o1', definition: strictPart }],
  [vWire('w', { type: 'device', deviceId: 'board', pinId: 'VIN' }, { type: 'device', deviceId: 'o1', pinId: 'VCC' })],
);
eq('finding ids are stable across runs',
   again.map((i) => i.id).sort().join(','), over.map((i) => i.id).sort().join(','));

// 9. Every finding names the device it is about, so the inspector can show it.
eq('findings reference their device', over.every((i) => i.deviceIds.length > 0), true);

// --- dynamic short: a button bridging two rails ----------------------------
// This is the case the static checks cannot see. Power and ground pins may not
// be wired together directly, so the only route to a short is a switch closing
// across two rails — which needs the solver's bond pass to notice.
function railBridge(pressed: boolean) {
  const button = deviceById('button')!;
  const devices: SimulatedDevice[] = [boardDevice, { instanceId: 'btn', definition: button, properties: { pressed, mode: 'no' } }];
  const behaviors = new Map<string, DeviceBehavior>();
  behaviors.set('btn', button.simulation!('btn'));
  return simulateTick(
    {
      devices,
      connections: [
        vWire('a', { type: 'device', deviceId: 'board', pinId: '3V3' }, { type: 'device', deviceId: 'btn', pinId: '1' }),
        vWire('b', { type: 'device', deviceId: 'btn', pinId: '3' }, { type: 'device', deviceId: 'board', pinId: 'GND-L' }),
      ],
      deltaMs: 16,
    },
    behaviors,
  );
}

eq('open button across rails is safe', railBridge(false).shorts.length, 0);
eq('closed button across rails shorts', railBridge(true).shorts.length > 0, true);
eq(
  'shorted pin is flagged as conflicting',
  railBridge(true).pinStates.get(devicePinKey('btn', '1'))?.conflict,
  true,
);

// --- breadboard actually conducts ------------------------------------------
// Two parts plugged into the same column must end up on one net; the ravine
// and neighbouring columns must stay isolated.
function breadboardRig(ledColumn: string) {
  const bb = deviceById('breadboard-half')!;
  const led = deviceById('led')!;
  const devices: SimulatedDevice[] = [
    boardDevice,
    { instanceId: 'bb', definition: bb, properties: {} },
    { instanceId: 'l1', definition: led, properties: { color: 'red' } },
  ];
  const behaviors = new Map<string, DeviceBehavior>();
  for (const d of devices) if (d.definition.simulation) behaviors.set(d.instanceId, d.definition.simulation(d.instanceId));
  return simulateTick(
    {
      devices,
      connections: [
        // 3V3 into hole A1, LED anode into hole E1 (same column, same strip).
        vWire('a', { type: 'device', deviceId: 'board', pinId: '3V3' }, { type: 'device', deviceId: 'bb', pinId: 'A1' }),
        vWire('b', { type: 'device', deviceId: 'bb', pinId: ledColumn }, { type: 'device', deviceId: 'l1', pinId: 'A' }),
        vWire('c', { type: 'device', deviceId: 'l1', pinId: 'K' }, { type: 'device', deviceId: 'board', pinId: 'GND-L' }),
      ],
      deltaMs: 16,
    },
    behaviors,
  );
}

eq('same column conducts (A1 -> E1)', (breadboardRig('E1').runtime['l1']?.['brightness'] as number) > 0, true);
eq('across the ravine does not (A1 -> F1)', breadboardRig('F1').runtime['l1']?.['brightness'], 0);
eq('a different column does not (A1 -> E2)', breadboardRig('E2').runtime['l1']?.['brightness'], 0);

// --- LED without a series resistor -----------------------------------------
const ledDef = deviceById('led')!;
const resistorDef = deviceById('resistor')!;

const bare = validate(
  [{ instanceId: 'l1', definition: ledDef }],
  [
    vWire('a', { type: 'device', deviceId: 'board', pinId: '3V3' }, { type: 'device', deviceId: 'l1', pinId: 'A' }),
    vWire('b', { type: 'device', deviceId: 'l1', pinId: 'K' }, { type: 'device', deviceId: 'board', pinId: 'GND-L' }),
  ],
);
eq('bare LED on a rail warns', bare.some((i) => i.code === 'no-series-resistor'), true);
eq('that warning is not an error', bare.find((i) => i.code === 'no-series-resistor')?.severity, 'warning');

const guarded = validate(
  [
    { instanceId: 'l1', definition: ledDef },
    { instanceId: 'r1', definition: resistorDef },
  ],
  [
    vWire('a', { type: 'device', deviceId: 'board', pinId: '3V3' }, { type: 'device', deviceId: 'r1', pinId: '1' }),
    vWire('b', { type: 'device', deviceId: 'r1', pinId: '2' }, { type: 'device', deviceId: 'l1', pinId: 'A' }),
    vWire('c', { type: 'device', deviceId: 'l1', pinId: 'K' }, { type: 'device', deviceId: 'board', pinId: 'GND-L' }),
  ],
);
eq('a series resistor clears the warning', guarded.filter((i) => i.code === 'no-series-resistor').length, 0);

// A part that is not current-sensitive must never trigger it.
const oledOnRail = validate(
  [{ instanceId: 'o1', definition: oled }],
  [vWire('a', { type: 'device', deviceId: 'board', pinId: '3V3' }, { type: 'device', deviceId: 'o1', pinId: 'VCC' })],
);
eq('modules on a rail are fine', oledOnRail.filter((i) => i.code === 'no-series-resistor').length, 0);

// --- potentiometer as a real divider ---------------------------------------
// Needs the solver's relaxation: the wiper cannot be computed until the end
// terminals have resolved.
function potRig(position: number) {
  const pot = deviceById('potentiometer')!;
  const devices: SimulatedDevice[] = [boardDevice, { instanceId: 'p1', definition: pot, properties: { wiper: position / 100 * 4095, resistance: 10000, taper: 'linear' } }];
  const behaviors = new Map<string, DeviceBehavior>();
  behaviors.set('p1', pot.simulation!('p1'));
  const result = simulateTick(
    {
      devices,
      connections: [
        vWire('a', { type: 'device', deviceId: 'board', pinId: '3V3' }, { type: 'device', deviceId: 'p1', pinId: '3' }),
        vWire('b', { type: 'device', deviceId: 'p1', pinId: '1' }, { type: 'device', deviceId: 'board', pinId: 'GND-L' }),
      ],
      deltaMs: 50,
    },
    behaviors,
  );
  return result.pinStates.get(devicePinKey('p1', 'WIPER'))!;
}

eq('wiper at 0 % sits at ground', Math.round(potRig(0).voltage * 100) / 100, 0);
eq('wiper at 100 % reaches the rail', Math.round(potRig(100).voltage * 100) / 100, 3.3);
eq('wiper at 50 % halves the rail', Math.round(potRig(50).voltage * 100) / 100, 1.65);
eq('wiper at 25 %', Math.round(potRig(25).voltage * 100) / 100, 0.83);

// --- PIR hold timing --------------------------------------------------------
function pirRun(steps: readonly { motion: boolean; dt: number }[], repeatMode: boolean) {
  const pir = deviceById('pir-hc-sr501')!;
  const behavior = pir.simulation!('s1');
  const behaviors = new Map<string, DeviceBehavior>([['s1', behavior]]);
  let last: ReturnType<typeof simulateTick> | undefined;
  for (const step of steps) {
    last = simulateTick(
      {
        devices: [boardDevice, {
          instanceId: 's1',
          definition: pir,
          properties: { motion: step.motion, delay: 2, sensitivity: 60, retrigger: repeatMode },
        }],
        connections: [vWire('pir-vcc', { type: 'device', deviceId: 'board', pinId: 'VIN' }, { type: 'device', deviceId: 's1', pinId: 'VCC' }), vWire('pir-gnd', { type: 'device', deviceId: 'board', pinId: 'GND-L' }, { type: 'device', deviceId: 's1', pinId: 'GND' })],
        deltaMs: step.dt,
      },
      behaviors,
    );
  }
  return last!.runtime['s1'];
}

eq('idle PIR is not triggered', pirRun([{ motion: false, dt: 50 }], true)?.['triggered'], false);
eq('motion triggers', pirRun([{ motion: true, dt: 50 }], true)?.['triggered'], true);
eq(
  'output holds after motion stops',
  pirRun([{ motion: true, dt: 50 }, { motion: false, dt: 500 }], true)?.['triggered'],
  true,
);
eq(
  'output releases once the delay elapses',
  pirRun([{ motion: true, dt: 50 }, { motion: false, dt: 2100 }], true)?.['triggered'],
  false,
);
eq(
  'repeat mode keeps extending while motion continues',
  pirRun([{ motion: true, dt: 50 }, { motion: true, dt: 5000 }], true)?.['triggered'],
  true,
);
eq(
  'single mode does not extend',
  pirRun([{ motion: true, dt: 50 }, { motion: true, dt: 5000 }], false)?.['triggered'],
  false,
);

// PIR drives its OUT pin high while held.
const pirDef = deviceById('pir-hc-sr501')!;
const pirBehavior = pirDef.simulation!('s1');
const pirBehaviors = new Map<string, DeviceBehavior>([['s1', pirBehavior]]);
const pirInput = (motion: boolean, dt: number) => simulateTick(
  {
    devices: [boardDevice, { instanceId: 's1', definition: pirDef, properties: { motion, delay: 2, retrigger: true } }],
    connections: [vWire('pir-vcc', { type: 'device', deviceId: 'board', pinId: 'VIN' }, { type: 'device', deviceId: 's1', pinId: 'VCC' }), vWire('pir-gnd', { type: 'device', deviceId: 'board', pinId: 'GND-L' }, { type: 'device', deviceId: 's1', pinId: 'GND' })],
    deltaMs: dt,
  },
  pirBehaviors,
);
pirInput(true, 50);
eq('OUT is driven high while triggered',
   pirInput(true, 50).pinStates.get(devicePinKey('s1', 'OUT'))?.voltage, 3.3);


// --- a battery powers a circuit with no board ------------------------------
// The battery is a standalone source, so its + terminal must drive a net even
// when no ESP32 rail is present. Diode direction and the resistor split are
// exercised in one go.
function batteryRig(reversed: boolean) {
  const battery = deviceById(`battery-aa-4`)!;   // 6 V pack
  const diode = deviceById(`diode-1n4007`)!;
  const resistor = deviceById(`resistor`)!;
  const led = deviceById(`led`)!;
  const devices: SimulatedDevice[] = [
    { instanceId: `bat`, definition: battery, properties: { voltage: 6 } },
    { instanceId: `d1`, definition: diode, properties: {} },
    { instanceId: `r1`, definition: resistor, properties: { resistance: 220 } },
    { instanceId: `l1`, definition: led, properties: { color: `red` } },
  ];
  const behaviors = new Map<string, DeviceBehavior>();
  for (const d of devices) if (d.definition.simulation) behaviors.set(d.instanceId, d.definition.simulation(d.instanceId));
  // battery + -> diode A, diode K -> resistor 1, resistor 2 -> LED A, LED K -> battery -
  const wires = reversed
    ? [
        vWire(`w1`, { type: `device`, deviceId: `bat`, pinId: `+` }, { type: `device`, deviceId: `d1`, pinId: `K` }),
        vWire(`w2`, { type: `device`, deviceId: `d1`, pinId: `A` }, { type: `device`, deviceId: `r1`, pinId: `1` }),
      ]
    : [
        vWire(`w1`, { type: `device`, deviceId: `bat`, pinId: `+` }, { type: `device`, deviceId: `d1`, pinId: `A` }),
        vWire(`w2`, { type: `device`, deviceId: `d1`, pinId: `K` }, { type: `device`, deviceId: `r1`, pinId: `1` }),
      ];
  wires.push(
    vWire(`w3`, { type: `device`, deviceId: `r1`, pinId: `2` }, { type: `device`, deviceId: `l1`, pinId: `A` }),
    vWire(`w4`, { type: `device`, deviceId: `l1`, pinId: `K` }, { type: `device`, deviceId: `bat`, pinId: `-` }),
  );
  return simulateTick({ devices, connections: wires, deltaMs: 50 }, behaviors);
}

eq(`battery lights an LED with no board`, (batteryRig(false).runtime[`l1`]?.[`brightness`] as number) > 0, true);
eq(`a reversed diode blocks the current`, batteryRig(true).runtime[`l1`]?.[`brightness`], 0);
eq(`diode reports conducting forward`, batteryRig(false).runtime[`d1`]?.[`conducting`], true);
eq(`diode reports blocked when reversed`, batteryRig(true).runtime[`d1`]?.[`conducting`], false);

// A resistor in the path clears the no-series-resistor warning even off-board.
const battLedWarnings = validate(
  [
    { instanceId: `bat`, definition: deviceById(`battery-aa-4`) },
    { instanceId: `l1`, definition: deviceById(`led`) },
  ],
  [
    vWire(`a`, { type: `device`, deviceId: `bat`, pinId: `+` }, { type: `device`, deviceId: `l1`, pinId: `A` }),
    vWire(`b`, { type: `device`, deviceId: `l1`, pinId: `K` }, { type: `device`, deviceId: `bat`, pinId: `-` }),
  ],
);
eq(`bare LED on a battery warns too`, battLedWarnings.some((i) => i.code === `no-series-resistor`), true);

// ---------------------------------------------------------------------------
// Physical scale.
//
// Every part is drawn from one shared authority: real millimetres, converted by
// PIXELS_PER_MM. A part missing `physicalSize`, or whose artwork disagrees with
// the millimetres it claims, is drawn at the wrong size relative to everything
// around it — the exact failure this system exists to prevent, and one that
// stays invisible until a user puts two parts side by side.
// ---------------------------------------------------------------------------

for (const device of DEVICES) {
  eq(device.id + ' declares physical size', device.physicalSize !== undefined, true);
  eq(device.id + ' has declarative artwork', device.render !== undefined, true);

  // 2 % tolerance: below that the stretch is under half a pixel on a 40 mm part.
  const mismatch = aspectRatioMismatch(device);
  if (mismatch > 0.02) {
    fail++;
    console.log(
      '  FAIL ' + device.id + ' aspect ratio: drawn ' +
      (device.width / device.height).toFixed(3) + ' vs physical ' +
      ((device.physicalSize?.widthMm ?? 0) / (device.physicalSize?.heightMm ?? 1)).toFixed(3),
    );
  } else pass++;
}

// Pins must sit on the artwork. A pin outside the body plus its declared bleed
// is a pin the user cannot see, so a wire would appear to start from nowhere.
for (const device of DEVICES) {
  const bleed = device.render?.bleed ?? {};
  const minX = -(bleed.left ?? 0);
  const minY = -(bleed.top ?? 0);
  const maxX = device.width + (bleed.right ?? 0);
  const maxY = device.height + (bleed.bottom ?? 0);

  const strays = device.pins.filter(
    (devicePin) =>
      devicePin.x < minX || devicePin.x > maxX || devicePin.y < minY || devicePin.y > maxY,
  );
  if (strays.length > 0) {
    fail++;
    console.log(
      '  FAIL ' + device.id + ' pins outside the artwork: ' +
      strays.map((p) => p.name + '(' + p.x + ',' + p.y + ')').join(' '),
    );
  } else pass++;
}

// Neighbouring pins must not steal each other's clicks. Two hit circles that
// overlap leave the seam between them unselectable, which reads to a user as
// the canvas ignoring the pin they aimed at.
for (const device of DEVICES) {
  const radius = device.pinHitRadius ?? 9.5;
  let closest = Infinity;
  let pair = '';
  for (let a = 0; a < device.pins.length; a++) {
    for (let b = a + 1; b < device.pins.length; b++) {
      const distance = Math.hypot(
        device.pins[a].x - device.pins[b].x,
        device.pins[a].y - device.pins[b].y,
      );
      if (distance < closest) {
        closest = distance;
        pair = device.pins[a].name + '/' + device.pins[b].name;
      }
    }
  }
  if (device.pins.length > 1 && closest < radius * 2) {
    fail++;
    console.log(
      '  FAIL ' + device.id + ' pin hit areas overlap: ' + pair + ' are ' +
      closest.toFixed(1) + ' apart, hit radius ' + radius,
    );
  } else pass++;
}

// --- summary ---------------------------------------------------------------
console.log(`\ndevices=${DEVICES.length} shapeRendered=${shapeRendered} legacyArt=${legacyArt}`);
console.log(`pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
