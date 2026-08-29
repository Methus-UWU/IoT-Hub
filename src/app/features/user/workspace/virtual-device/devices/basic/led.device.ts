import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { PART } from '../core/device-palette';
import { PIN_PITCH } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, ellipse, line, path, text, type Shape } from '../core/device-shape';
import {
  isLogicHigh,
  propertyNumber,
  type DeviceBehavior,
  type DeviceSimulationContext,
} from '../core/device-simulation';

const WIDTH = 104;
const HEIGHT = 140;
const CENTER_X = WIDTH / 2;
const BODY_TOP = 16;
const BODY_BOTTOM = 76;
const BODY_HALF_WIDTH = 16;
const ANODE_X = CENTER_X - PIN_PITCH / 2;
const CATHODE_X = CENTER_X + PIN_PITCH / 2;

/** Emitted colour and typical forward drop per LED colour. */
const LED_TONES: Readonly<Record<string, { color: string; forward: number }>> = {
  red: { color: '#ff3b30', forward: 1.8 },
  green: { color: '#34d058', forward: 2.1 },
  blue: { color: '#4a9eff', forward: 3.0 },
  yellow: { color: '#ffd60a', forward: 2.1 },
  white: { color: '#f8fafc', forward: 3.1 },
  orange: { color: '#ff9f0a', forward: 2.0 },
};

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'color',
    label: 'Colour',
    kind: 'select',
    defaultValue: 'red',
    group: 'general',
    options: [
      { value: 'red', label: 'Red' },
      { value: 'green', label: 'Green' },
      { value: 'blue', label: 'Blue' },
      { value: 'yellow', label: 'Yellow' },
      { value: 'white', label: 'White' },
      { value: 'orange', label: 'Orange' },
    ],
  },
  {
    id: 'size',
    label: 'Package',
    kind: 'select',
    defaultValue: '5',
    unit: 'mm',
    group: 'general',
    options: [
      { value: '3', label: '3 mm' },
      { value: '5', label: '5 mm' },
      { value: '10', label: '10 mm' },
    ],
  },
  {
    id: 'brightness',
    label: 'Brightness',
    kind: 'number',
    defaultValue: 0,
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    simulationOnly: true,
    description: 'Driven by the voltage across the LED while the simulation runs.',
  },
];

/**
 * Forward voltage decides whether the die conducts at all, and how far past it
 * the drive sits decides how bright it looks. Anything under the threshold is
 * genuinely dark, which is what makes a missing series resistor or a reversed
 * LED visible on the canvas rather than silently working.
 */
export function ledBrightness(across: number, forwardVoltage: number): number {
  if (across <= forwardVoltage) return 0;
  return Math.min((across - forwardVoltage) / 1.2, 1);
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const tone = LED_TONES[stringState(context, 'color', 'red')] ?? LED_TONES['red'];
  const scale = Number(stringState(context, 'size', '5')) / 5;
  const level = numberState(context, 'brightness', 0) / 100;
  const lit = level > 0.02;
  const packageScale = 0.82 + scale * 0.18;
  const halfWidth = BODY_HALF_WIDTH * packageScale;
  const domeBottom = BODY_TOP + halfWidth;

  return [
    // Leads. The anode is drawn longer, as on a real through-hole LED.
    line(ANODE_X, BODY_BOTTOM - 1, ANODE_X, HEIGHT, {
      stroke: PART.metal,
      strokeWidth: 3.5,
      strokeLinecap: 'round',
    }),
    line(CATHODE_X, BODY_BOTTOM - 1, CATHODE_X, HEIGHT - 16, {
      stroke: PART.metal,
      strokeWidth: 3.5,
      strokeLinecap: 'round',
    }),

    // Halo only while lit, and scaled by brightness so PWM reads visually.
    ...(lit
      ? [
          circle(CENTER_X, BODY_TOP + 31, halfWidth + 12 * level, {
            fill: tone.color,
            opacity: 0.18 * level,
          }),
        ]
      : []),

    // Narrow, tall epoxy package like a real 5 mm through-hole LED.
    path(
      `M ${CENTER_X - halfWidth} ${BODY_BOTTOM}
       V ${domeBottom}
       A ${halfWidth} ${halfWidth} 0 0 1 ${CENTER_X + halfWidth} ${domeBottom}
       V ${BODY_BOTTOM} Z`,
      {
        fill: tone.color,
        opacity: lit ? 0.88 + level * 0.12 : 0.82,
        stroke: '#a52620',
        strokeWidth: 1.5,
      },
    ),

    // Flange, flattened on the cathode side exactly as the real package is.
    ellipse(CENTER_X, BODY_BOTTOM, halfWidth + 3, 4.5, {
      fill: tone.color,
      opacity: lit ? 1 : 0.88,
      stroke: '#a52620',
      strokeWidth: 1.25,
    }),

    // Subtle internal reflector and highlight keep the package readable.
    path(`M ${CENTER_X + 2} ${domeBottom + 8} l 10 9 v 26 l -10 6 z`, {
      fill: '#b91f1a',
      opacity: lit ? 0.3 : 0.42,
      detail: 'normal',
    }),
    path(`M ${CENTER_X - 8} ${domeBottom + 2} V ${BODY_BOTTOM - 12}`, {
      fill: 'none',
      stroke: '#fff5f4',
      strokeWidth: 2.2,
      strokeLinecap: 'round',
      opacity: lit ? 0.72 : 0.48,
      detail: 'normal',
    }),

    text(ANODE_X, HEIGHT - 2, '+', {
      size: 11,
      fill: '#6b7280',
      anchor: 'middle',
      weight: 700,
      detail: 'normal',
    }),
  ];
}

function createBehavior(): DeviceBehavior {
  return {
    update(context: DeviceSimulationContext) {
      const anode = context.readNode('A');
      const cathode = context.readNode('K');
      const forward = LED_TONES[String(context.properties['color'] ?? 'red')]?.forward ?? 1.8;

      // A floating leg means the LED is not in a complete circuit at all.
      if (anode.floating || cathode.floating) {
        context.emit('brightness', 0);
        return;
      }

      const level = ledBrightness(anode.voltage - cathode.voltage, forward);
      context.emit('brightness', Math.round(level * 100));
    },
    reset() {
      /* All state lives on the nodes, so there is nothing to clear. */
    },
  };
}

/** 5 mm through-hole LED. */
export const LED_5MM: VirtualDevice = {
  id: 'led',
  name: 'LED',
  model: '5 mm through-hole',
  description: 'Lights when forward voltage is applied. Always pair with a series resistor.',
  x: 240,
  y: 288,
  width: WIDTH,
  height: HEIGHT,
  // 5 mm through-hole LED, drawn with its legs: 5.2 mm across, 7 mm tall.
  physicalSize: { widthMm: 5.2, heightMm: 7 },
  operatingVoltage: { min: 1.8, max: 3.4, recommended: 3.3 },
  interfaces: ['digital', 'pwm'],
  pins: [
    pin('A', ANODE_X, HEIGHT, 'passive', {
      side: 'bottom',
      description: 'Anode — the longer leg, wire toward the positive supply',
    }),
    pin('K', CATHODE_X, HEIGHT - 16, 'passive', {
      side: 'bottom',
      description: 'Cathode — flat side of the flange, wire toward ground',
    }),
  ],
  properties: PROPERTIES,
  render: { draw, bleed: { left: 18, right: 18 } },
  requiresSeriesResistor: true,
  simulation: createBehavior,
  catalog: {
    categoryId: 'leds',
    category: 'LEDs',
    aliases: ['indicator light', 'light emitting diode', 'ไฟ LED', 'diode'],
    tags: ['led', 'output', 'indicator', 'diode', 'light', 'digital', 'pwm'],
    interfaceLabel: 'เอาต์พุตดิจิทัล · 2 ขา',
    typicalUsage: 'Power, connectivity, alarm, and application status indication.',
  },
};
