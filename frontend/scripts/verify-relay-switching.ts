/**
 * Relay switching, checked against the real simulator.
 *
 * The relay was the one part in the catalog with interactive state and no simulation
 * behaviour: its channels toggled by clicking, its NO/COM/NC terminals were drawn but
 * had no pins, and nothing it "switched" was connected to anything. This script is the
 * evidence that both halves now work — the coil follows its trigger input, and the
 * contact actually carries current to a load.
 *
 * The rig is the one a bench test uses: two LEDs, each in series with its own channel,
 * interlocked so that only one is ever lit.
 *
 *   3V3 → resistor → LED → COMn , NOn → GND
 *
 * Run it from `frontend/`:
 *
 *   node_modules/@esbuild/win32-x64/esbuild.exe scripts/verify-relay-switching.ts \
 *     --bundle --platform=node --format=cjs --outfile=.tmp/verify-relay.cjs \
 *     && node .tmp/verify-relay.cjs
 *
 * On other platforms swap the esbuild binary path (`node_modules/.bin/esbuild`).
 */

import {
  DEVICES,
  deviceById,
} from '../src/app/features/user/workspace/virtual-device/devices/device-catalog';
import type { DeviceBehavior } from '../src/app/features/user/workspace/virtual-device/devices/core/device-simulation';
import { simulateTick } from '../src/app/features/user/workspace/virtual-device/simulation/circuit-simulator';
import type { WireConnection } from '../src/app/features/user/workspace/virtual-device/models/virtual-device.model';

// Touching the catalog is what registers every part.
void DEVICES;

let pass = 0;
let fail = 0;

function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
    return;
  }
  fail++;
  console.log(`  FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

const esp = deviceById('esp32-devkit-v1')!;
const relay = deviceById('relay2')!;
const led = deviceById('led')!;
const resistor = deviceById('resistor')!;

const devices = [
  { instanceId: 'esp', definition: esp, properties: {} },
  { instanceId: 'rly', definition: relay, properties: { ch1: false, ch2: false } },
  { instanceId: 'la', definition: led, properties: { color: 'red' } },
  { instanceId: 'lb', definition: led, properties: { color: 'green' } },
  { instanceId: 'ra', definition: resistor, properties: { resistance: 220 } },
  { instanceId: 'rb', definition: resistor, properties: { resistance: 220 } },
];

let wireCount = 0;
function wire(from: readonly [string, string], to: readonly [string, string]): WireConnection {
  return {
    id: `w${++wireCount}`,
    start: { type: 'device', deviceId: from[0], pinId: from[1] },
    end: { type: 'device', deviceId: to[0], pinId: to[1] },
    waypoints: [],
    color: '#000',
    kind: 'signal',
  };
}

const connections: WireConnection[] = [
  wire(['esp', 'VIN'], ['rly', 'VCC']),
  wire(['esp', 'GND-L'], ['rly', 'GND']),
  wire(['esp', 'GPIO32'], ['rly', 'IN1']),
  wire(['esp', 'GPIO33'], ['rly', 'IN2']),

  wire(['esp', '3V3'], ['ra', '1']),
  wire(['ra', '2'], ['la', 'A']),
  wire(['la', 'K'], ['rly', 'COM1']),
  wire(['rly', 'NO1'], ['esp', 'GND-L']),

  wire(['esp', '3V3'], ['rb', '1']),
  wire(['rb', '2'], ['lb', 'A']),
  wire(['lb', 'K'], ['rly', 'COM2']),
  wire(['rly', 'NO2'], ['esp', 'GND-R']),
];

interface RigResult {
  channelOne: boolean;
  channelTwo: boolean;
  ledA: number;
  ledB: number;
}

/**
 * Runs the rig with the two trigger pins held at the given levels.
 *
 * The board has no behaviour of its own — it is a passive part in the catalog — so this
 * stands in for the sketch, driving the rails and the two GPIOs. Several ticks are run
 * because the coil follows its input by one tick, exactly as a real relay does.
 */
function run(triggerOneHigh: boolean, triggerTwoHigh: boolean): RigResult {
  const behaviors = new Map<string, DeviceBehavior>();
  for (const device of devices) {
    if (device.definition.simulation) {
      behaviors.set(device.instanceId, device.definition.simulation());
    }
  }
  behaviors.set('esp', {
    drive(context) {
      context.drive('3V3', 3.3);
      context.drive('VIN', 5);
      context.drive('GND-L', 0);
      context.drive('GND-R', 0);
      context.drive('GPIO32', triggerOneHigh ? 3.3 : 0);
      context.drive('GPIO33', triggerTwoHigh ? 3.3 : 0);
    },
  });

  let result = simulateTick({ devices, connections, deltaMs: 16 }, behaviors);
  for (let tick = 0; tick < 5; tick++) {
    result = simulateTick({ devices, connections, deltaMs: 16 }, behaviors);
  }

  return {
    channelOne: result.runtime['rly']?.['ch1'] === true,
    channelTwo: result.runtime['rly']?.['ch2'] === true,
    ledA: Number(result.runtime['la']?.['brightness'] ?? 0),
    ledB: Number(result.runtime['lb']?.['brightness'] ?? 0),
  };
}

console.log('Relay switching');

// These modules are opto-isolated and active low: pulling the trigger down energises.
const aOn = run(false, true);
eq('IN1 low energises channel 1', aOn.channelOne, true);
eq('channel 2 stays at rest', aOn.channelTwo, false);
eq('LED A lights through its contact', aOn.ledA > 0, true);
eq('LED B stays dark', aOn.ledB, 0);

const bOn = run(true, false);
eq('IN2 low energises channel 2', bOn.channelTwo, true);
eq('channel 1 stays at rest', bOn.channelOne, false);
eq('LED B lights through its contact', bOn.ledB > 0, true);
eq('LED A stays dark', bOn.ledA, 0);

const idle = run(true, true);
eq(
  'both triggers high leaves both channels at rest',
  [idle.channelOne, idle.channelTwo],
  [false, false],
);
eq('neither LED is lit at rest', [idle.ledA, idle.ledB], [0, 0]);

console.log('Terminal pins');

const relayPins = relay.pins.map((relayPin) => relayPin.name);
for (const name of ['IN1', 'IN2', 'NO1', 'COM1', 'NC1', 'NO2', 'COM2', 'NC2']) {
  eq(`relay2 declares ${name}`, relayPins.includes(name), true);
}

const singleChannel = deviceById('relay')!.pins.map((relayPin) => relayPin.name);
eq('a 1-channel relay drops the channel number', singleChannel.includes('COM'), true);
eq('and does not invent a second channel', singleChannel.includes('COM2'), false);

// Every pin must sit on the drawn part, or a wire would attach to empty canvas. Header
// pins are the tips of leads that run past the board edge, so the declared bleed —
// the area the artwork really draws into — counts as part of the body.
const bleed = relay.render?.bleed ?? {};
const outside = relay.pins.filter(
  (relayPin) =>
    relayPin.x < -(bleed.left ?? 0) - 1 ||
    relayPin.y < -(bleed.top ?? 0) - 1 ||
    relayPin.x > relay.width + (bleed.right ?? 0) + 1 ||
    relayPin.y > relay.height + (bleed.bottom ?? 0) + 1,
);
eq(
  'every relay pin sits on the board',
  outside.map((p) => p.name),
  [],
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
