import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { mixHex, OUTLINE, PART, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, line, path, rect, text, type Shape } from '../core/device-shape';
import { propertyNumber, requiresSupply, type DeviceBehavior } from '../core/device-simulation';

/**
 * LM393 photoresistor module.
 *
 * The board follows the common four-pin layout: the GL5528 cell and sensitivity
 * trimmer sit on the left, the comparator and indicator LEDs occupy the middle,
 * and VCC/GND/DO/AO leave through the header on the right.
 */

const BODY = bodyFromMm({ widthMm: 31, heightMm: 14 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

const SENSOR_X = u(2.2);
const SENSOR_Y = HEIGHT / 2;
const SENSOR_R = u(2.8);
const TRACK_HALF_WIDTH = u(1.25);
const TRACK_HALF_HEIGHT = u(1.25);
const TRACK_COLUMNS = 5;

const HEADER_X = WIDTH - u(1.2);
const HEADER_LEAD_END = WIDTH + u(4);
const HEADER_Y = u(3.1);

const PINS = [
  ['VCC', 'vcc', '3.3-5 V supply'],
  ['GND', 'gnd', 'Ground reference'],
  ['DO', 'digital', 'Comparator output; high below the configured light threshold'],
  ['AO', 'analog', 'Analog light-level output'],
] as const;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'lux',
    label: 'Light level',
    kind: 'number',
    defaultValue: 300,
    min: 0.1,
    max: 20_000,
    step: 0.1,
    unit: 'lux',
    group: 'simulation',
    description: 'Ambient illuminance falling on the photoresistor.',
  },
  {
    id: 'thresholdLux',
    label: 'Digital threshold',
    kind: 'number',
    defaultValue: 300,
    min: 0.1,
    max: 20_000,
    step: 0.1,
    unit: 'lux',
    group: 'simulation',
    description: 'Sensitivity-trimmer threshold used by the DO comparator output.',
  },
  {
    id: 'darkResistance',
    label: 'Resistance at 10 lux',
    kind: 'number',
    defaultValue: 10_000,
    min: 100,
    max: 1_000_000,
    step: 100,
    unit: 'Ω',
    group: 'electrical',
    description: 'Datasheet reference point for the GL5528 cell.',
  },
];

/** Standard log-log response of the GL5528 photoresistor. */
export function ldrResistance(lux: number, resistanceAt10Lux = 10_000, gamma = 0.7): number {
  const safeLux = Math.max(lux, 0.1);
  return resistanceAt10Lux * (safeLux / 10) ** -gamma;
}

/** Maps the useful illuminance range to the module's nominal 3.3 V output. */
export function ldrAnalogVoltage(lux: number): number {
  const minimumLux = 0.1;
  const maximumLux = 20_000;
  const safeLux = Math.min(Math.max(lux, minimumLux), maximumLux);
  const range = Math.log10(maximumLux) - Math.log10(minimumLux);
  return (3.3 * (Math.log10(safeLux) - Math.log10(minimumLux))) / range;
}

function meanderPath(): string {
  const top = SENSOR_Y - TRACK_HALF_HEIGHT;
  const bottom = SENSOR_Y + TRACK_HALF_HEIGHT;
  const step = (TRACK_HALF_WIDTH * 2) / (TRACK_COLUMNS - 1);

  let d = `M ${SENSOR_X - TRACK_HALF_WIDTH} ${top}`;
  for (let column = 0; column < TRACK_COLUMNS; column++) {
    const x = SENSOR_X - TRACK_HALF_WIDTH + step * column;
    const y = column % 2 === 0 ? bottom : top;
    d += ` L ${x} ${y}`;
    if (column < TRACK_COLUMNS - 1) d += ` L ${x + step} ${y}`;
  }
  return d;
}

const MEANDER = meanderPath();

function smdResistor(x: number, y: number): readonly Shape[] {
  return [
    rect(x, y, u(3), u(1.15), {
      rx: u(0.12),
      fill: '#eee9dc',
      stroke: OUTLINE,
      strokeWidth: u(0.08),
    }),
    rect(x, y, u(0.65), u(1.15), { fill: '#aeb6c2' }),
    rect(x + u(2.35), y, u(0.65), u(1.15), { fill: '#aeb6c2' }),
  ];
}

function comparator(x: number, y: number): readonly Shape[] {
  const chipWidth = u(4.8);
  const chipHeight = u(6.6);
  const leadLength = u(1.1);
  const leadHeight = u(0.42);

  return [
    ...Array.from({ length: 4 }, (_, index) => {
      const leadY = y + u(0.8) + index * u(1.65);
      return [
        rect(x - leadLength, leadY, leadLength + u(0.2), leadHeight, { fill: '#aeb6c2' }),
        rect(x + chipWidth - u(0.2), leadY, leadLength + u(0.2), leadHeight, {
          fill: '#aeb6c2',
        }),
      ];
    }).flat(),
    rect(x, y, chipWidth, chipHeight, {
      rx: u(0.35),
      fill: '#20252d',
      stroke: OUTLINE,
      strokeWidth: u(0.12),
    }),
    circle(x + u(0.75), y + u(0.75), u(0.28), { fill: PART.icShine }),
    text(x + chipWidth / 2, y + chipHeight / 2 + u(0.35), 'LM393', {
      size: u(0.75),
      fill: SILK.dim,
      anchor: 'middle',
      mono: true,
      weight: 600,
      rotate: -90,
      detail: 'high',
    }),
  ];
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const lux = numberState(context, 'lux', 300);
  const thresholdLux = numberState(context, 'thresholdLux', 300);
  const reference = numberState(context, 'darkResistance', 10_000);
  const digitalHigh = lux < thresholdLux;
  const brightness = Math.min(Math.max(Math.log10(Math.max(lux, 1)) / 4, 0), 1);
  const faceBase = mixHex('#6a5115', '#f7e9ae', brightness);

  return [
    rect(0, 0, WIDTH, HEIGHT, {
      rx: u(0.45),
      fill: '#263f78',
      stroke: '#15264d',
      strokeWidth: u(0.18),
    }),
    rect(u(0.25), u(0.25), WIDTH - u(0.5), HEIGHT - u(0.5), {
      rx: u(0.3),
      fill: 'none',
      stroke: '#5d78ae',
      strokeWidth: u(0.1),
      opacity: 0.6,
    }),

    path(`M ${u(4.8)} ${u(3)} H ${u(9)} V ${u(7)} H ${u(17)}`, {
      fill: 'none',
      stroke: '#5271a8',
      strokeWidth: u(0.18),
      opacity: 0.55,
      detail: 'high',
    }),
    path(`M ${u(4.8)} ${u(11)} H ${u(10.5)} V ${u(9.6)} H ${u(22.5)}`, {
      fill: 'none',
      stroke: '#5271a8',
      strokeWidth: u(0.18),
      opacity: 0.55,
      detail: 'high',
    }),

    line(SENSOR_X + u(1), SENSOR_Y - u(2.5), SENSOR_X + u(4.4), u(3.4), {
      stroke: PART.metal,
      strokeWidth: u(0.34),
      strokeLinecap: 'round',
    }),
    line(SENSOR_X + u(1), SENSOR_Y + u(2.5), SENSOR_X + u(4.4), u(10.6), {
      stroke: PART.metal,
      strokeWidth: u(0.34),
      strokeLinecap: 'round',
    }),
    circle(SENSOR_X, SENSOR_Y, SENSOR_R, {
      fill: '#ddd5bf',
      stroke: OUTLINE,
      strokeWidth: u(0.14),
    }),
    circle(SENSOR_X, SENSOR_Y, SENSOR_R - u(0.42), {
      fill: faceBase,
      stroke: mixHex(faceBase, '#000000', 0.28),
      strokeWidth: u(0.08),
    }),
    path(MEANDER, {
      fill: 'none',
      stroke: '#342b18',
      strokeWidth: u(0.3),
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),

    ...smdResistor(u(5.8), u(1.6)),
    ...smdResistor(u(5.8), u(4.45)),
    ...smdResistor(u(5.8), u(7.3)),
    ...smdResistor(u(5.8), u(10.15)),

    rect(u(10.5), u(2.7), u(6.9), u(7.3), {
      rx: u(0.35),
      fill: '#3979c7',
      stroke: '#153d75',
      strokeWidth: u(0.15),
    }),
    circle(u(13.95), u(6.35), u(1.75), {
      fill: '#c9ced6',
      stroke: '#67717d',
      strokeWidth: u(0.12),
    }),
    line(u(12.35), u(6.35), u(15.55), u(6.35), {
      stroke: '#6b7280',
      strokeWidth: u(0.34),
      strokeLinecap: 'round',
    }),

    ...comparator(u(18.15), u(5.65)),
    ...smdResistor(u(18.9), u(1.7)),
    ...smdResistor(u(18.9), u(12.1)),

    // Both lamps follow the module's own supply, not the Start button.
    circle(u(25.1), u(5.15), u(1.05), {
      fill: context.running && context.state['powered'] === true ? '#ff5a5a' : '#7a2b2b',
      stroke: '#431b1b',
      strokeWidth: u(0.1),
    }),
    circle(u(25.1), u(9.2), u(0.72), {
      fill:
        context.running && context.state['powered'] === true && digitalHigh ? '#ff5a5a' : '#7a2b2b',
      stroke: '#431b1b',
      strokeWidth: u(0.1),
    }),
    text(u(25.1), u(3.2), 'PWR', {
      size: u(0.7),
      fill: SILK.white,
      anchor: 'middle',
      mono: true,
      weight: 700,
    }),
    text(u(25.1), u(7.9), 'DO', {
      size: u(0.7),
      fill: SILK.white,
      anchor: 'middle',
      mono: true,
      weight: 700,
    }),

    rect(HEADER_X - u(1.25), HEADER_Y - HEADER_PITCH / 2, u(2.5), HEADER_PITCH * PINS.length, {
      rx: u(0.2),
      fill: '#171a1f',
      stroke: '#0b0d10',
      strokeWidth: u(0.1),
    }),
    ...PINS.flatMap(([name], index) => {
      const y = HEADER_Y + index * HEADER_PITCH;
      return [
        rect(HEADER_X - u(0.45), y - u(0.45), u(0.9), u(0.9), {
          rx: u(0.08),
          fill: '#d8aa3e',
          stroke: '#8d6b1f',
          strokeWidth: u(0.08),
        }),
        rect(HEADER_X, y - u(0.28), HEADER_LEAD_END - HEADER_X, u(0.56), {
          rx: u(0.18),
          fill: '#aeb6c2',
          stroke: PART.metalDark,
          strokeWidth: u(0.06),
        }),
        text(HEADER_X - u(1.65), y + u(0.3), name, {
          size: u(0.72),
          fill: SILK.white,
          anchor: 'end',
          mono: true,
          weight: 700,
          detail: 'normal',
        }),
      ];
    }),

    text(u(15.3), u(13.25), `${formatOhms(ldrResistance(lux, reference))} LDR`, {
      size: u(0.72),
      fill: SILK.dim,
      anchor: 'middle',
      mono: true,
      detail: 'high',
    }),
  ];
}

function formatOhms(ohms: number): string {
  if (ohms >= 1_000_000) return `${(ohms / 1_000_000).toFixed(1)} MΩ`;
  if (ohms >= 1_000) return `${(ohms / 1_000).toFixed(1)} kΩ`;
  return `${Math.round(ohms)} Ω`;
}

function createBehavior(): DeviceBehavior {
  return {
    drive(context) {
      const lux = propertyNumber(context, 'lux', 300);
      const thresholdLux = propertyNumber(context, 'thresholdLux', 300);
      context.drive('AO', ldrAnalogVoltage(lux), 'strong');
      context.drive('DO', lux < thresholdLux ? 3.3 : 0, 'strong');
    },
    update(context) {
      const lux = propertyNumber(context, 'lux', 300);
      const thresholdLux = propertyNumber(context, 'thresholdLux', 300);
      context.emit('analogVoltage', ldrAnalogVoltage(lux));
      context.emit('digitalHigh', lux < thresholdLux);
    },
  };
}

export const LDR: VirtualDevice = {
  id: 'ldr',
  name: 'LDR light sensor module',
  model: 'GL5528 + LM393',
  description: 'Measures ambient light with analog and adjustable digital outputs.',
  x: 720,
  y: 520,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  printsOwnPinLabels: true,
  operatingVoltage: { min: 3.3, max: 5, recommended: 3.3 },
  interfaces: ['analog', 'digital', 'power'],
  pins: PINS.map(([name, type, description], index) =>
    pin(name, HEADER_LEAD_END, HEADER_Y + index * HEADER_PITCH, type, {
      side: 'right',
      direction: name === 'AO' || name === 'DO' ? 'output' : undefined,
      description,
      voltage: name === 'VCC' ? 3.3 : undefined,
    }),
  ),
  properties: PROPERTIES,
  simulation: requiresSupply(createBehavior, { minimumVolts: 2.7 }),
  render: { draw, bleed: { left: u(0.7), right: u(4) } },
  catalog: {
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: [
      'ldr',
      'photoresistor',
      'light sensor',
      'light sensor module',
      'ตัวต้านทานแสง',
      'cds cell',
    ],
    tags: [
      'ldr',
      'light',
      'photoresistor',
      'analog',
      'digital',
      'sensor',
      'lm393',
      'cds',
      'ambient',
    ],
    interfaceLabel: 'Analog / digital · 4 pins',
    typicalUsage: 'Automatic lighting, brightness sensing, and adjustable light/dark detection.',
  },
};
