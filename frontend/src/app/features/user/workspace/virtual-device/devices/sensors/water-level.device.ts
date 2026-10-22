import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { FLAT, PCB, SILK, WOKWI } from '../core/device-palette';
import { flatChip, flatHeader, flatLed, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { rect, type Shape } from '../core/device-shape';
import { propertyNumber, requiresSupply, type DeviceBehavior } from '../core/device-simulation';

/**
 * Water level sensor — the red board with ten exposed traces.
 *
 * Alternate traces are tied to two combs. Water bridging them switches on a
 * transistor, so the more of the comb is under water the higher S reads. It is a
 * level *indicator*, not a depth gauge: the reading is not linear and it drifts
 * as the traces corrode.
 *
 * Drawn upright with the header at the top, the way it hangs in a tank.
 */

const BODY = bodyFromMm({ widthMm: 20, heightMm: 62 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

const HEADER_Y = u(2.4);
/** Leads stand out of the top edge. */
const LEAD_END = -u(4);

/** The exposed comb: ten traces, alternately tied to the left and right rails. */
const TRACE_TOP = u(16);
const TRACE_PITCH = u(4.4);
const TRACE_COUNT = 10;
const TRACE_HEIGHT = u(1.2);
/** The span a water level of 0–100 % maps onto. */
const WET_TOP = u(15);
const WET_BOTTOM = HEIGHT - u(3);

const PINS = [
  ['S', 'analog', 'Analog level; rises as more of the traces are under water'],
  ['+', 'vcc', '3.3–5 V supply'],
  ['-', 'gnd', 'Ground reference'],
] as const;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'level',
    label: 'Water level',
    kind: 'number',
    defaultValue: 30,
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    description: 'How much of the trace area is under water.',
  },
];

/** Roughly 70 % of the rail with the comb fully submerged. */
export function waterLevelVoltage(levelPercent: number, rail = 3.3): number {
  return (rail * 0.7 * Math.min(Math.max(levelPercent, 0), 100)) / 100;
}

function pinX(index: number): number {
  return WIDTH / 2 + (index - 1) * HEADER_PITCH;
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const level = Math.min(Math.max(numberState(context, 'level', 30), 0), 100);
  const waterTop = WET_BOTTOM - ((WET_BOTTOM - WET_TOP) * level) / 100;
  const lastTraceY = TRACE_TOP + (TRACE_COUNT - 1) * TRACE_PITCH;

  return [
    rect(0, 0, WIDTH, HEIGHT, {
      rx: u(1),
      fill: PCB.red,
      stroke: PCB.redDark,
      strokeWidth: u(0.2),
    }),

    // Header along the top edge, leads standing up out of it.
    ...PINS.map((_, index) =>
      rect(pinX(index) - u(0.28), LEAD_END, u(0.56), HEADER_Y - LEAD_END, {
        rx: u(0.18),
        fill: FLAT.metal,
        stroke: FLAT.metalDark,
        strokeWidth: u(0.06),
      }),
    ),
    ...flatHeader(pinX(0), HEADER_Y, PINS.length),
    ...PINS.map(([name], index) =>
      silkLabel(pinX(index), HEADER_Y + u(3.2), name === '-' ? '−' : name, {
        size: u(1.1),
        weight: 700,
        detail: 'normal',
      }),
    ),

    // S8050 transistor, its two resistors, and the power LED.
    ...flatChip(u(2), u(7.6), u(3.2), u(2.4), 'Q1', u(0.6)),
    ...[u(6.4), u(10)].map((x) =>
      rect(x, u(8.2), u(2.4), u(1.2), { rx: u(0.15), fill: WOKWI.module, detail: 'normal' }),
    ),
    ...flatLed(
      u(15.8),
      u(9),
      context.running && context.state['powered'] === true ? WOKWI.ledRed : WOKWI.ledRedOff,
    ),
    silkLabel(WIDTH / 2, u(13.6), 'WATER SENSOR', { size: u(1.05), detail: 'normal' }),

    // The comb: two rails, and traces reaching across from each in turn.
    rect(u(2), TRACE_TOP, u(1), lastTraceY - TRACE_PITCH + TRACE_HEIGHT - TRACE_TOP, {
      fill: WOKWI.pinLead,
    }),
    rect(
      WIDTH - u(3),
      TRACE_TOP + TRACE_PITCH,
      u(1),
      lastTraceY - TRACE_PITCH - TRACE_TOP + TRACE_HEIGHT,
      {
        fill: WOKWI.pinLead,
      },
    ),
    ...Array.from({ length: TRACE_COUNT }, (_, index) =>
      rect(
        index % 2 === 0 ? u(2) : u(3.5),
        TRACE_TOP + index * TRACE_PITCH,
        u(14.5),
        TRACE_HEIGHT,
        {
          fill: WOKWI.pinLead,
        },
      ),
    ),

    // The water itself, rising from the bottom of the board.
    ...(level > 0
      ? [
          rect(u(0.6), waterTop, WIDTH - u(1.2), HEIGHT - u(0.6) - waterTop, {
            rx: u(0.6),
            fill: FLAT.blue,
            opacity: 0.35,
          }),
        ]
      : []),
  ];
}

function createBehavior(): DeviceBehavior {
  return {
    drive(context) {
      context.drive('S', waterLevelVoltage(propertyNumber(context, 'level', 30)), 'strong');
    },
    update(context) {
      const volts = waterLevelVoltage(propertyNumber(context, 'level', 30));
      context.emit('analogVoltage', Math.round(volts * 100) / 100);
    },
  };
}

export const WATER_LEVEL: VirtualDevice = {
  id: 'water-level',
  name: 'Water level sensor',
  model: 'Water Sensor (S8050 comb)',
  description: 'Exposed-trace probe whose analog output rises as more of it is under water.',
  x: 720,
  y: 240,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  printsOwnPinLabels: true,
  operatingVoltage: { min: 3, max: 5, recommended: 3.3 },
  interfaces: ['analog', 'power'],
  pins: PINS.map(([name, type, description], index) =>
    pin(name, pinX(index), LEAD_END, type, {
      side: 'top',
      direction: name === 'S' ? 'output' : undefined,
      description,
      voltage: name === '+' ? 3.3 : undefined,
    }),
  ),
  properties: PROPERTIES,
  readings: [{ id: 'analogVoltage', label: 'Output voltage', unit: 'V' }],
  simulation: requiresSupply(createBehavior, { minimumVolts: 3, supplyPin: '+', groundPin: '-' }),
  render: { draw, bleed: { top: u(4.5) } },
  catalog: {
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: [
      'water level sensor',
      'water sensor',
      'water detector',
      'เซนเซอร์วัดระดับน้ำ',
      'ระดับน้ำ',
    ],
    tags: ['water', 'level', 'analog', 'sensor', 'tank', 'flood', 'leak'],
    interfaceLabel: 'แอนะล็อก · 3 ขา',
    typicalUsage: 'Tank level alerts, leak detection, and flood warnings.',
  },
};
