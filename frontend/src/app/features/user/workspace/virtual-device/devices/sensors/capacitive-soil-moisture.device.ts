import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { FLAT, SILK, WOKWI } from '../core/device-palette';
import { flatChip, flatHeader } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { line, path, rect, text, type Shape } from '../core/device-shape';
import { propertyNumber, requiresSupply, type DeviceBehavior } from '../core/device-simulation';

/**
 * Capacitive soil moisture sensor v1.2.
 *
 * The replacement people reach for once an FC-28 has corroded: the sensing plate
 * is copper under solder mask, so no metal touches the soil and there is nothing
 * to eat away. A 555 drives the plate as part of an RC oscillator and the board
 * turns that into a DC level, which is why there is one analog output and no
 * comparator or digital pin.
 *
 * Drawn lying down with the tip to the left. The white line near the electronics
 * is the printed limit: soil above it wets the circuitry, not the plate.
 */

const BODY = bodyFromMm({ widthMm: 98, heightMm: 23 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
const CENTRE_Y = HEIGHT / 2;

/** The printed maximum insertion depth, where the blade meets the electronics. */
const DEPTH_LINE_X = u(66);
const HEADER_X = WIDTH - u(2.5);
const LEAD_END = WIDTH + u(4);

const PINS = [
  ['GND', 'gnd', 'Ground reference'],
  ['VCC', 'vcc', '3.3–5.5 V supply'],
  ['AOUT', 'analog', 'Analog moisture level; falls as the soil gets wetter'],
] as const;

/** Output in dry air and fully soaked, on a 3.3 V supply. */
const DRY_VOLTS = 2.6;
const WET_VOLTS = 1.1;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'moisture',
    label: 'Soil moisture',
    kind: 'number',
    defaultValue: 35,
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    description: 'Volumetric water content around the plate.',
  },
];

/**
 * Dry reads high and wet reads low, like the FC-28 — but the swing is narrower
 * and never reaches either rail, so the calibration values differ.
 */
export function capacitiveSoilVoltage(moisturePercent: number): number {
  const wetness = Math.min(Math.max(moisturePercent, 0), 100) / 100;
  return DRY_VOLTS - (DRY_VOLTS - WET_VOLTS) * wetness;
}

function pinY(index: number): number {
  return CENTRE_Y + (index - 1) * HEADER_PITCH;
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const moisture = numberState(context, 'moisture', 35);

  return [
    // Board outline, with the point that goes into the soil first.
    path(
      `M 0 ${CENTRE_Y} L ${u(9)} 0 H ${WIDTH - u(1)} Q ${WIDTH} 0 ${WIDTH} ${u(1)} ` +
        `V ${HEIGHT - u(1)} Q ${WIDTH} ${HEIGHT} ${WIDTH - u(1)} ${HEIGHT} H ${u(9)} Z`,
      {
        fill: FLAT.plastic,
        stroke: '#0b0d10',
        strokeWidth: u(0.2),
        strokeLinejoin: 'round',
      },
    ),
    // The capacitive plate: copper under the mask, a shade lighter than the board.
    path(`M ${u(4)} ${CENTRE_Y} L ${u(11)} ${u(3)} H ${u(62)} V ${HEIGHT - u(3)} H ${u(11)} Z`, {
      fill: '#2b313a',
      stroke: '#3a414b',
      strokeWidth: u(0.12),
      detail: 'normal',
    }),
    text(u(36), CENTRE_Y + u(0.5), 'CAPACITIVE SOIL MOISTURE v1.2', {
      size: u(1.4),
      fill: SILK.dim,
      anchor: 'middle',
      mono: true,
      weight: 700,
      detail: 'normal',
    }),

    line(DEPTH_LINE_X, u(1.2), DEPTH_LINE_X, HEIGHT - u(1.2), {
      stroke: SILK.white,
      strokeWidth: u(0.35),
      detail: 'normal',
    }),
    text(DEPTH_LINE_X - u(1), HEIGHT - u(1.6), 'MAX', {
      size: u(0.9),
      fill: SILK.white,
      anchor: 'end',
      mono: true,
      weight: 700,
      detail: 'normal',
    }),

    // TLC555 oscillator and the 662K regulator, with their passives.
    ...flatChip(u(71), u(4), u(6), u(5), '555', u(0.9)),
    ...flatChip(u(71), u(13.5), u(4), u(4), '662K', u(0.65)),
    ...[u(5), u(8), u(15)].map((y) =>
      rect(u(80), y, u(2.4), u(1.2), {
        rx: u(0.15),
        fill: WOKWI.module,
        detail: 'normal',
      }),
    ),
    text(u(80), HEIGHT - u(1.4), `${Math.round(moisture)}%`, {
      size: u(0.9),
      fill: SILK.soft,
      anchor: 'middle',
      mono: true,
      weight: 700,
      detail: 'high',
    }),

    // Three-way header on the end, leads standing out past the board.
    ...flatHeader(HEADER_X, pinY(0), PINS.length, 'vertical'),
    ...PINS.flatMap(([name], index) => [
      rect(HEADER_X, pinY(index) - u(0.28), LEAD_END - HEADER_X, u(0.56), {
        rx: u(0.18),
        fill: FLAT.metal,
        stroke: FLAT.metalDark,
        strokeWidth: u(0.06),
      }),
      text(HEADER_X - u(1.6), pinY(index) + u(0.3), name, {
        size: u(0.8),
        fill: SILK.white,
        anchor: 'end',
        mono: true,
        weight: 700,
        detail: 'normal',
      }),
    ]),
  ];
}

function createBehavior(): DeviceBehavior {
  return {
    drive(context) {
      const moisture = propertyNumber(context, 'moisture', 35);
      context.drive('AOUT', capacitiveSoilVoltage(moisture), 'strong');
    },
    update(context) {
      const moisture = propertyNumber(context, 'moisture', 35);
      context.emit('analogVoltage', Math.round(capacitiveSoilVoltage(moisture) * 100) / 100);
    },
  };
}

export const CAPACITIVE_SOIL_MOISTURE: VirtualDevice = {
  id: 'soil-moisture-capacitive',
  name: 'Capacitive soil moisture sensor',
  model: 'Capacitive Soil Moisture Sensor v1.2',
  description: 'Corrosion-free soil moisture probe with a single analog output.',
  x: 700,
  y: 200,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  printsOwnPinLabels: true,
  operatingVoltage: { min: 3.3, max: 5.5, recommended: 3.3 },
  interfaces: ['analog', 'power'],
  pins: PINS.map(([name, type, description], index) =>
    pin(name, LEAD_END, pinY(index), type, {
      side: 'right',
      direction: name === 'AOUT' ? 'output' : undefined,
      description,
      voltage: name === 'VCC' ? 3.3 : undefined,
    }),
  ),
  properties: PROPERTIES,
  readings: [{ id: 'analogVoltage', label: 'Output voltage', unit: 'V' }],
  simulation: requiresSupply(createBehavior, { minimumVolts: 3 }),
  render: { draw, bleed: { right: u(4.5) } },
  catalog: {
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: [
      'capacitive soil moisture',
      'soil moisture v1.2',
      'capacitive soil sensor',
      'เซนเซอร์ความชื้นในดินแบบคาปาซิทีฟ',
      'ความชื้นดิน',
    ],
    tags: [
      'soil',
      'moisture',
      'capacitive',
      'analog',
      'sensor',
      'garden',
      'irrigation',
      'smart farm',
    ],
    interfaceLabel: 'แอนะล็อก · 3 ขา',
    typicalUsage: 'Long-running plant watering and smart-farm probes that must not corrode.',
  },
};
