import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  booleanState,
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, PART, PCB, SILK } from '../core/device-palette';
import { board, maleHeader, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, path, repeat, text, type Shape } from '../core/device-shape';
import {
  propertyBoolean,
  propertyNumber,
  type DeviceBehavior,
} from '../core/device-simulation';

/**
 * HC-SR501 passive infrared motion detector.
 *
 * A 32 × 24 mm board almost entirely covered by a 23 mm Fresnel dome — which is
 * exactly what the real module looks like from above, and why only the corners
 * of green solder mask and the two trimmers show. Drawing it any other way would
 * make the dome look like a decoration rather than the sensor itself.
 */

const BODY = bodyFromMm({ widthMm: 32, heightMm: 24 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

/** Fresnel dome: 23 mm across, sitting slightly proud of the top edge. */
const LENS_CX = WIDTH / 2;
const LENS_CY = u(10);
const LENS_R = u(11.5);

const PIN_Y = u(22.6);
const PIN_START_X = WIDTH / 2 - HEADER_PITCH;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'motion',
    label: 'Motion detected',
    kind: 'boolean',
    defaultValue: false,
    group: 'simulation',
    simulationOnly: true,
    description: 'Drives the OUT pin high for the configured delay.',
  },
  {
    id: 'delay',
    label: 'Output delay',
    kind: 'number',
    defaultValue: 5,
    min: 0.3,
    max: 300,
    step: 0.1,
    unit: 's',
    group: 'simulation',
    description: 'How long OUT stays high after a trigger (Tx trimmer).',
  },
  {
    id: 'sensitivity',
    label: 'Sensitivity',
    kind: 'number',
    defaultValue: 60,
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    description: 'Detection range trimmer (Sx), roughly 3–7 m.',
  },
  {
    id: 'retrigger',
    label: 'Repeat trigger',
    kind: 'boolean',
    defaultValue: true,
    group: 'advanced',
    description: 'H keeps the output high while motion continues; L pulses once.',
  },
];

function draw(context: DeviceDrawContext): readonly Shape[] {
  // `triggered` is the simulated output and outlives the motion input by the
  // configured delay; `motion` is only the raw stimulus. Drawing the input
  // would hide the hold behaviour that makes this sensor what it is.
  const triggered = context.state['triggered'];
  const motion =
    typeof triggered === 'boolean'
      ? triggered
      : booleanState(context, 'motion') && context.running;
  const sensitivity = numberState(context, 'sensitivity', 60);

  return [
    ...board(0, 0, WIDTH, HEIGHT, PCB.green, { rx: u(0.8), edge: PCB.greenDark }),

    // Sensitivity and delay trimmers, on the strips of board the dome leaves
    // visible. On the real module they are on the back; here they have to be
    // reachable, and this is the only place they fit.
    ...[u(3.4), WIDTH - u(3.4)].map((cx, index) => [
      circle(cx, u(20.4), u(2.4), {
        fill: index === 0 ? '#e0b544' : '#2f6fbf',
        stroke: OUTLINE,
        strokeWidth: u(0.12),
        detail: 'normal',
      }),
      circle(cx, u(20.4), u(1.4), { fill: PART.metalLight, detail: 'normal' }),
    ]).flat(),
    silkLabel(u(3.4), u(23.6), 'Sx', { size: u(1), fill: SILK.soft, detail: 'high' }),
    silkLabel(WIDTH - u(3.4), u(23.6), 'Tx', { size: u(1), fill: SILK.soft, detail: 'high' }),

    // Fresnel dome: faceted white plastic, the part's defining feature.
    circle(LENS_CX, LENS_CY, LENS_R, {
      fill: '#f4f5f7',
      stroke: '#b7bcc4',
      strokeWidth: u(0.25),
    }),
    circle(LENS_CX, LENS_CY, LENS_R - u(1), {
      fill: '#eceef1',
      stroke: '#c9ced6',
      strokeWidth: u(0.12),
      detail: 'normal',
    }),
    // Radial facet lines.
    ...repeat(8, {}, (index) => {
      const angle = (index * Math.PI) / 8;
      const dx = Math.cos(angle) * (LENS_R - u(0.8));
      const dy = Math.sin(angle) * (LENS_R - u(0.8));
      return path(`M ${LENS_CX - dx} ${LENS_CY - dy} L ${LENS_CX + dx} ${LENS_CY + dy}`, {
        stroke: '#d3d8de',
        strokeWidth: u(0.15),
        detail: 'normal',
      });
    }),
    // Concentric facet rings.
    ...[0.62, 0.3].map((fraction) =>
      circle(LENS_CX, LENS_CY, LENS_R * fraction, {
        fill: 'none',
        stroke: '#d3d8de',
        strokeWidth: u(0.15),
        detail: 'normal',
      }),
    ),

    // Detection indicator. Only lit while triggered, never a permanent glow.
    ...(motion
      ? [
          circle(LENS_CX, LENS_CY, LENS_R + u(1.2), { fill: '#22c55e', opacity: 0.22 }),
          circle(LENS_CX, LENS_CY, u(1.8), { fill: '#22c55e', opacity: 0.55 }),
        ]
      : []),

    ...maleHeader(PIN_START_X, PIN_Y, 3, 'horizontal'),
    ...['VCC', 'OUT', 'GND'].map((name, index) =>
      text(PIN_START_X + index * HEADER_PITCH, PIN_Y - u(1.9), name, {
        size: u(0.9),
        fill: SILK.white,
        anchor: 'middle',
        mono: true,
        weight: 600,
        detail: 'high',
      }),
    ),

    // Board name along the left margin, the only silk the dome leaves room for.
    text(u(1.4), HEIGHT / 2, 'HC-SR501', {
      size: u(1.1),
      fill: SILK.soft,
      anchor: 'middle',
      mono: true,
      weight: 600,
      rotate: -90,
      detail: 'normal',
    }),
    text(WIDTH - u(1.4), HEIGHT / 2, motion ? 'MOTION' : `${Math.round(sensitivity)}%`, {
      size: u(1.1),
      fill: motion ? '#4ade80' : SILK.dim,
      anchor: 'middle',
      mono: true,
      weight: 700,
      rotate: -90,
      detail: 'normal',
    }),
  ];
}

export const PIR_HC_SR501: VirtualDevice = {
  id: 'pir-hc-sr501',
  name: 'PIR motion sensor',
  model: 'HC-SR501',
  description: 'Detects body heat moving across its field of view and pulses OUT high.',
  x: 700,
  y: 620,
  ...BODY,
  initiallyVisible: false,
  operatingVoltage: { min: 4.5, max: 20, recommended: 5 },
  interfaces: ['digital'],
  pins: [
    pin('VCC', PIN_START_X, PIN_Y, 'vcc', {
      side: 'bottom',
      description: '4.5–20 V supply',
      voltage: 5,
    }),
    pin('OUT', PIN_START_X + HEADER_PITCH, PIN_Y, 'digital', {
      side: 'bottom',
      direction: 'output',
      description: '3.3 V logic high while motion is detected',
    }),
    pin('GND', PIN_START_X + HEADER_PITCH * 2, PIN_Y, 'gnd', {
      side: 'bottom',
      description: 'Ground reference',
    }),
  ],
  properties: PROPERTIES,
  // The dome stands proud of the top edge, as it does on the real module.
  render: { draw, bleed: { top: u(2) } },
  catalog: {
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: ['pir', 'motion sensor', 'hc-sr501', 'เซนเซอร์ตรวจจับการเคลื่อนไหว'],
    tags: ['pir', 'motion', 'infrared', 'sensor', 'security', 'digital', 'presence'],
    interfaceLabel: 'เอาต์พุตดิจิทัล · 3 ขา',
    typicalUsage: 'Occupancy lighting, intruder alarms, and presence-triggered automation.',
  },
};

/**
 * HC-SR501 output timing.
 *
 * The module does not follow motion directly: a trigger latches OUT high for
 * the Tx delay, and the jumper decides what a *second* trigger during that
 * window does. In repeat (H) mode it restarts the countdown so continuous
 * presence holds the output high; in single (L) mode it is ignored, which is
 * why a real sensor in L mode blinks rather than staying on.
 */
function createPirBehavior(): DeviceBehavior {
  let remainingMs = 0;
  let previousMotion = false;

  return {
    drive(context) {
      if (remainingMs > 0) context.drive('OUT', 3.3, 'strong');
    },
    update(context) {
      const motion = propertyBoolean(context, 'motion');
      const delayMs = propertyNumber(context, 'delay', 5) * 1000;
      const repeatMode = propertyBoolean(context, 'retrigger', true);

      const rising = motion && !previousMotion;
      previousMotion = motion;

      if (rising || (motion && repeatMode)) remainingMs = delayMs;
      else remainingMs = Math.max(0, remainingMs - context.deltaMs);

      context.emit('triggered', remainingMs > 0);
      context.emit('holdSeconds', Math.round((remainingMs / 1000) * 10) / 10);
    },
    reset() {
      remainingMs = 0;
      previousMotion = false;
    },
  };
}

PIR_HC_SR501.simulation = createPirBehavior;
