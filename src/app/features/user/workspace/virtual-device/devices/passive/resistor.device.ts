import {
  numberState,
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, u } from '../core/device-metrics';
import { pin } from '../core/device-pin';
import { line, rect, type Shape } from '../core/device-shape';
import type { DeviceBehavior } from '../core/device-simulation';
import type { VirtualDevice } from '../../models/virtual-device.model';

/**
 * A 1/4 W axial resistor: a 6.5 × 2.4 mm ceramic body between two leads. Small
 * enough that on a canvas beside an ESP32 it reads as the speck it really is,
 * which is the point of drawing it to scale at all.
 */
const LEAD = u(2.5);
const BODY_X = LEAD;
const BODY_WIDTH = u(6.5);
const BODY = bodyFromMm({ widthMm: 11.5, heightMm: 2.6 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
const MID_Y = HEIGHT / 2;
const BODY_HALF = u(1.2);

/** IEC 60062 band colours, indexed by digit. */
const DIGIT_COLORS = [
  '#1a1a1a',
  '#7b4a12',
  '#d32f2f',
  '#f57c00',
  '#fbc02d',
  '#388e3c',
  '#1976d2',
  '#7b1fa2',
  '#8a8a8a',
  '#fafafa',
] as const;

const MULTIPLIER_GOLD = '#c9a227';
const MULTIPLIER_SILVER = '#c0c0c0';

const TOLERANCE_COLORS: Readonly<Record<string, string>> = {
  '1': '#7b4a12',
  '2': '#d32f2f',
  '5': MULTIPLIER_GOLD,
  '10': MULTIPLIER_SILVER,
};

/**
 * Splits a resistance into the two significant digits and the decimal exponent
 * a four-band resistor encodes. Values below 10 Ω use the gold/silver
 * multipliers, which is why the exponent is allowed to go negative.
 */
export function resistorBands(ohms: number): {
  first: number;
  second: number;
  exponent: number;
} {
  const safe = Math.max(ohms, 0.01);
  let exponent = Math.floor(Math.log10(safe)) - 1;
  let significand = Math.round(safe / 10 ** exponent);

  // Rounding 99.6 → 100 pushes us to three digits; renormalise.
  if (significand >= 100) {
    significand = Math.round(significand / 10);
    exponent += 1;
  }

  return {
    first: Math.floor(significand / 10),
    second: significand % 10,
    exponent,
  };
}

function multiplierColor(exponent: number): string {
  if (exponent === -2) return MULTIPLIER_SILVER;
  if (exponent === -1) return MULTIPLIER_GOLD;
  return DIGIT_COLORS[Math.min(Math.max(exponent, 0), 9)];
}

/** Formats 4700 as "4.7 kΩ" — the label a schematic would carry. */
export function formatResistance(ohms: number): string {
  if (ohms >= 1_000_000) return `${trimZeros(ohms / 1_000_000)} MΩ`;
  if (ohms >= 1_000) return `${trimZeros(ohms / 1_000)} kΩ`;
  return `${trimZeros(ohms)} Ω`;
}

function trimZeros(value: number): string {
  return Number(value.toFixed(2)).toString();
}

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'resistance',
    label: 'Resistance',
    kind: 'number',
    defaultValue: 220,
    min: 0.1,
    max: 10_000_000,
    step: 1,
    unit: 'Ω',
    group: 'electrical',
    description: 'Drives the printed colour bands.',
  },
  {
    id: 'tolerance',
    label: 'Tolerance',
    kind: 'select',
    defaultValue: '5',
    group: 'electrical',
    options: [
      { value: '1', label: '±1 % (brown)' },
      { value: '2', label: '±2 % (red)' },
      { value: '5', label: '±5 % (gold)' },
      { value: '10', label: '±10 % (silver)' },
    ],
  },
  {
    id: 'power',
    label: 'Power rating',
    kind: 'select',
    defaultValue: '0.25',
    unit: 'W',
    group: 'electrical',
    options: [
      { value: '0.125', label: '1/8 W' },
      { value: '0.25', label: '1/4 W' },
      { value: '0.5', label: '1/2 W' },
      { value: '1', label: '1 W' },
    ],
  },
];

function draw(context: DeviceDrawContext): readonly Shape[] {
  const ohms = numberState(context, 'resistance', 220);
  const tolerance = stringState(context, 'tolerance', '5');
  const { first, second, exponent } = resistorBands(ohms);

  const bandColors = [
    DIGIT_COLORS[first],
    DIGIT_COLORS[second],
    multiplierColor(exponent),
    TOLERANCE_COLORS[tolerance] ?? MULTIPLIER_GOLD,
  ];
  // Three bands clustered left, the tolerance band set apart on the right —
  // the visual gap is how you tell which end to read from.
  const bandX = [BODY_X + u(1.2), BODY_X + u(2.1), BODY_X + u(3), BODY_X + u(5.1)];

  return [
    // Axial leads.
    line(0, MID_Y, BODY_X, MID_Y, {
      stroke: '#b8b8b8',
      strokeWidth: u(0.5),
      strokeLinecap: 'square',
    }),
    line(WIDTH, MID_Y, BODY_X + BODY_WIDTH, MID_Y, {
      stroke: '#b8b8b8',
      strokeWidth: u(0.5),
      strokeLinecap: 'square',
    }),

    // A clean capsule: the moulded body has no hard outline in the flesh, and
    // giving it one makes the colour bands harder to read at small sizes.
    rect(BODY_X, MID_Y - BODY_HALF, BODY_WIDTH, BODY_HALF * 2, {
      rx: BODY_HALF,
      fill: '#dec29f',
    }),

    // Flat IEC colour bands. Their positions remain independent of the value,
    // while their colours are derived from the configured resistance.
    ...bandColors.map((color, index) =>
      rect(bandX[index], MID_Y - BODY_HALF, index === 3 ? u(0.5) : u(0.6), BODY_HALF * 2, {
        fill: color,
        opacity: 1,
      }),
    ),
  ];
}

/** Axial through-hole resistor. Bands are derived from the resistance value. */
export const RESISTOR: VirtualDevice = {
  id: 'resistor',
  name: 'Resistor',
  model: 'Axial 1/4 W',
  description: 'Limits current. Colour bands follow the configured resistance.',
  x: 120,
  y: 700,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  pins: [
    pin('1', 0, MID_Y, 'passive', { side: 'left', description: 'Resistors are not polarised' }),
    pin('2', WIDTH, MID_Y, 'passive', {
      side: 'right',
      description: 'Resistors are not polarised',
    }),
  ],
  properties: PROPERTIES,
  interfaces: ['passive'],
  limitsCurrent: true,
  render: { draw },
  // A resistor passes voltage: without this bond it would be an open circuit
  // and every correctly-built LED circuit would stay dark. The current-limiting
  // it provides is checked structurally instead — see `limitsCurrent`.
  simulation: (): DeviceBehavior => ({
    connect: (context) => context.bond('1', '2'),
  }),
  catalog: {
    categoryId: 'passive-components',
    category: 'Passive Components',
    aliases: ['resistor', 'ตัวต้านทาน', 'ohm', 'current limiter'],
    tags: ['resistor', 'passive', 'ohm', 'current', 'pull-up', 'pull-down', 'series'],
    interfaceLabel: 'พาสซีฟ · 2 ขา',
    typicalUsage: 'Current limiting for LEDs, pull-up and pull-down networks, dividers.',
  },
};
