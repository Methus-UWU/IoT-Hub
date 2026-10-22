import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { PART } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, ellipse, path, text, type Shape } from '../core/device-shape';
import {
  type DeviceBehavior,
  type DeviceSimulationContext,
  type NodeState,
} from '../core/device-simulation';

/**
 * 5 mm through-hole LED.
 *
 * A T-1¾ package is 5 mm across the dome and 5.8 mm across the flange, standing
 * 8.6 mm tall, with its two leads on the usual 2.54 mm pitch. Those four numbers
 * are the whole part — everything drawn below is derived from them, which is why
 * changing the package size property rescales the body without moving the leads.
 */

const BODY = bodyFromMm({ widthMm: 6.2, heightMm: 14 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
const CENTER_X = WIDTH / 2;

/** Where the epoxy meets the flange. */
const BODY_BOTTOM = u(8.6);
/** Half the dome at the reference 5 mm package. */
const BODY_HALF_WIDTH = u(2.5);

/**
 * A T-1¾ stands 8.6 mm over a 5 mm dome, so the epoxy is 3.44 half-widths tall
 * — a straight barrel roughly twice the height of the hemisphere that caps it.
 * Deriving the height from the width is what keeps every package the same
 * slender shape instead of a squat blob whose barrel disappears as it grows.
 */
const HEIGHT_PER_HALF_WIDTH = 8.6 / 2.5;

/**
 * Tallest the epoxy may stand. A 10 mm package is genuinely taller than this
 * part's 14 mm box, so it is clipped to what the artwork's bleed can hold
 * rather than being drawn over the parts above it on the canvas.
 */
const MAX_BODY_HEIGHT = BODY_BOTTOM + u(3);

const ANODE_X = CENTER_X - HEADER_PITCH / 2;
const CATHODE_X = CENTER_X + HEADER_PITCH / 2;
const ANODE_EXIT_X = CENTER_X - u(1.05);
const CATHODE_EXIT_X = CENTER_X + u(1.05);
/** The cathode leg is cut shorter, which is how you tell it apart in hand. */
const CATHODE_LENGTH = HEIGHT - u(1.6);

/** Emitted colour and typical forward drop per LED colour. */
const LED_TONES: Readonly<Record<string, { color: string; edge: string; forward: number }>> = {
  red: { color: '#ff3b30', edge: '#a52620', forward: 1.8 },
  green: { color: '#34d058', edge: '#1f7a37', forward: 2.1 },
  blue: { color: '#4a9eff', edge: '#2159a8', forward: 3.0 },
  yellow: { color: '#ffd60a', edge: '#a8880a', forward: 2.1 },
  white: { color: '#f8fafc', edge: '#9aa2ad', forward: 3.1 },
  orange: { color: '#ff9f0a', edge: '#a86308', forward: 2.0 },
};

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'color',
    label: 'สี',
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
    label: 'ขนาด',
    kind: 'select',
    defaultValue: '5',
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

/**
 * Brightness of an LED whose anode or cathode may be on a PWM pin.
 *
 * A pulsed node reports its average voltage and the duty it is high for. The
 * LED does not see that average: it sees the full level for the high part of
 * each period and nothing for the rest, and the eye averages the light. So the
 * level is the brightness at the peak, scaled by how long the LED is on — which
 * is what makes `analogWrite(pin, 64)` glow at a quarter instead of sitting dark
 * because 0.8 V is below the forward voltage.
 *
 * On the cathode the pin sinks current, so the LED is on while the pin is low.
 */
export function pulsedLedBrightness(
  anode: NodeState,
  cathode: NodeState,
  forwardVoltage: number,
): number {
  if (anode.duty !== undefined) {
    return ledBrightness(anode.voltage / anode.duty - cathode.voltage, forwardVoltage) * anode.duty;
  }
  if (cathode.duty !== undefined) {
    return ledBrightness(anode.voltage, forwardVoltage) * (1 - cathode.duty);
  }
  return ledBrightness(anode.voltage - cathode.voltage, forwardVoltage);
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const tone = LED_TONES[stringState(context, 'color', 'red')] ?? LED_TONES['red'];
  const level = numberState(context, 'brightness', 0) / 100;
  const lit = level > 0.02;

  // A 3 mm part is genuinely smaller than a 10 mm one, but the leads stay on
  // 0.1 in pitch in every package — so only the body scales.
  const millimetres = Number(stringState(context, 'size', '5')) || 5;
  const halfWidth = u(millimetres / 2);
  const bodyHeight = Math.min(halfWidth * HEIGHT_PER_HALF_WIDTH, MAX_BODY_HEIGHT);
  // The hemisphere caps the barrel, so the shoulder is one radius below the top.
  const domeShoulder = BODY_BOTTOM - bodyHeight + halfWidth;

  return [
    // Leads. The anode is drawn longer, as on a real through-hole LED.
    path(
      `M ${ANODE_EXIT_X} ${BODY_BOTTOM - u(0.25)}` +
        ` C ${ANODE_EXIT_X} ${BODY_BOTTOM + u(0.65)}, ${ANODE_X} ${BODY_BOTTOM + u(0.75)}, ${ANODE_X} ${BODY_BOTTOM + u(1.45)}` +
        ` V ${HEIGHT}`,
      {
        fill: 'none',
        stroke: PART.metal,
        strokeWidth: u(0.5),
        strokeLinecap: 'round',
      },
    ),
    path(
      `M ${CATHODE_EXIT_X} ${BODY_BOTTOM - u(0.25)}` +
        ` C ${CATHODE_EXIT_X} ${BODY_BOTTOM + u(0.65)}, ${CATHODE_X} ${BODY_BOTTOM + u(0.75)}, ${CATHODE_X} ${BODY_BOTTOM + u(1.45)}` +
        ` V ${CATHODE_LENGTH}`,
      {
        fill: 'none',
        stroke: PART.metal,
        strokeWidth: u(0.5),
        strokeLinecap: 'round',
      },
    ),

    // Halo only while lit, and scaled by brightness so PWM reads visually.
    ...(lit
      ? [
          circle(CENTER_X, domeShoulder, halfWidth + u(1.4) * level, {
            fill: tone.color,
            opacity: 0.18 * level,
          }),
        ]
      : []),

    // Epoxy package: straight sides up to a hemispherical dome.
    path(
      `M ${CENTER_X - halfWidth} ${BODY_BOTTOM}` +
        ` V ${domeShoulder}` +
        ` A ${halfWidth} ${halfWidth} 0 0 1 ${CENTER_X + halfWidth} ${domeShoulder}` +
        ` V ${BODY_BOTTOM} Z`,
      {
        fill: tone.color,
        opacity: lit ? 0.88 + level * 0.12 : 0.82,
        stroke: tone.edge,
        strokeWidth: u(0.15),
      },
    ),

    // Flange, wider than the dome exactly as the real package is.
    ellipse(CENTER_X, BODY_BOTTOM, halfWidth + u(0.4), u(0.45), {
      fill: tone.color,
      opacity: lit ? 1 : 0.88,
      stroke: tone.edge,
      strokeWidth: u(0.13),
    }),

    // Internal reflector cup and a highlight down the near face.
    path(
      `M ${CENTER_X + u(0.2)} ${domeShoulder + u(0.8)} l ${u(1)} ${u(0.9)}` +
        ` v ${u(2.6)} l ${-u(1)} ${u(0.6)} z`,
      {
        fill: tone.edge,
        opacity: lit ? 0.3 : 0.42,
        detail: 'normal',
      },
    ),
    path(`M ${CENTER_X - u(0.8)} ${domeShoulder} V ${BODY_BOTTOM - u(1.2)}`, {
      fill: 'none',
      stroke: '#ffffff',
      strokeWidth: u(0.22),
      strokeLinecap: 'round',
      opacity: lit ? 0.72 : 0.48,
      detail: 'normal',
    }),

    text(ANODE_X, HEIGHT - u(0.2), '+', {
      size: u(1.1),
      fill: '#6b7280',
      anchor: 'middle',
      weight: 700,
      detail: 'high',
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

      const level = pulsedLedBrightness(anode, cathode, forward);
      context.emit('brightness', Math.round(level * 100));
    },
    reset() {
      /* All state lives on the nodes, so there is nothing to clear. */
    },
  };
}

export const LED_5MM: VirtualDevice = {
  id: 'led',
  name: 'LED',
  model: '5 mm through-hole',
  description: 'Lights when forward voltage is applied. Always pair with a series resistor.',
  x: 240,
  y: 288,
  ...BODY,
  operatingVoltage: { min: 1.8, max: 3.4, recommended: 3.3 },
  interfaces: ['digital', 'pwm'],
  pins: [
    pin('A', ANODE_X, HEIGHT, 'passive', {
      side: 'bottom',
      description: 'Anode — the longer leg, wire toward the positive supply',
    }),
    pin('K', CATHODE_X, CATHODE_LENGTH, 'passive', {
      side: 'bottom',
      description: 'Cathode — flat side of the flange, wire toward ground',
    }),
  ],
  properties: PROPERTIES,
  // A 10 mm package and its halo spill past the 6.2 mm body.
  render: { draw, bleed: { left: u(3), right: u(3), top: u(3) } },
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
