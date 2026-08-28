import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  booleanState,
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { OUTLINE, PART, PCB, SILK } from '../core/device-palette';
import { board, chip, maleHeader, PIN_PITCH, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, path, rect, repeat, text, type Shape } from '../core/device-shape';
import {
  propertyBoolean,
  propertyNumber,
  type DeviceBehavior,
} from '../core/device-simulation';

const WIDTH = 200;
const HEIGHT = 210;
const LENS_CX = WIDTH / 2;
const LENS_CY = 84;
const LENS_R = 74;
const PIN_Y = HEIGHT;
const PIN_START_X = WIDTH / 2 - PIN_PITCH;

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
    ...board(0, 30, WIDTH, HEIGHT - 30, PCB.green, { rx: 8, edge: PCB.greenDark }),

    // Support components peeking out from under the lens.
    ...chip(24, 132, 60, 26, 'BISS0001', { labelSize: 7 }),
    circle(150, 146, 13, {
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: 1,
      detail: 'normal',
    }),
    circle(180, 146, 13, {
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: 1,
      detail: 'normal',
    }),
    silkLabel(150, 168, 'Sx', { size: 8, fill: SILK.soft, detail: 'high' }),
    silkLabel(180, 168, 'Tx', { size: 8, fill: SILK.soft, detail: 'high' }),

    // Fresnel dome: faceted white plastic, the part's defining feature.
    circle(LENS_CX, LENS_CY, LENS_R, {
      fill: '#f4f5f7',
      stroke: '#b7bcc4',
      strokeWidth: 2,
    }),
    circle(LENS_CX, LENS_CY, LENS_R - 10, {
      fill: '#eceef1',
      stroke: '#c9ced6',
      strokeWidth: 1,
      detail: 'normal',
    }),
    // Radial facet lines.
    ...repeat(8, {}, (index) => {
      const angle = (index * Math.PI) / 8;
      const dx = Math.cos(angle) * (LENS_R - 8);
      const dy = Math.sin(angle) * (LENS_R - 8);
      return path(
        `M ${LENS_CX - dx} ${LENS_CY - dy} L ${LENS_CX + dx} ${LENS_CY + dy}`,
        { stroke: '#d3d8de', strokeWidth: 1.25, detail: 'normal' },
      );
    }),
    // Concentric facet rings.
    circle(LENS_CX, LENS_CY, LENS_R * 0.62, {
      fill: 'none',
      stroke: '#d3d8de',
      strokeWidth: 1.25,
      detail: 'normal',
    }),
    circle(LENS_CX, LENS_CY, LENS_R * 0.3, {
      fill: 'none',
      stroke: '#d3d8de',
      strokeWidth: 1.25,
      detail: 'normal',
    }),

    // Detection indicator. Only lit while triggered, never a permanent glow.
    ...(motion
      ? [
          circle(LENS_CX, LENS_CY, LENS_R + 12, { fill: '#22c55e', opacity: 0.22 }),
          circle(LENS_CX, LENS_CY, 16, { fill: '#22c55e', opacity: 0.55 }),
        ]
      : []),

    ...maleHeader(PIN_START_X, PIN_Y - 12, 3, 'horizontal'),
    silkLabel(WIDTH / 2, HEIGHT - 26, 'HC-SR501', { size: 10, fill: SILK.soft }),

    text(WIDTH / 2, 200, motion ? 'MOTION' : `${Math.round(sensitivity)}%`, {
      size: 9,
      fill: motion ? '#4ade80' : SILK.dim,
      anchor: 'middle',
      weight: 700,
      mono: true,
      detail: 'normal',
    }),
  ];
}

/** HC-SR501 passive infrared motion detector. */
export const PIR_HC_SR501: VirtualDevice = {
  id: 'pir-hc-sr501',
  name: 'PIR motion sensor',
  model: 'HC-SR501',
  description: 'Detects body heat moving across its field of view and pulses OUT high.',
  x: 700,
  y: 620,
  width: WIDTH,
  height: HEIGHT,
  initiallyVisible: false,
  operatingVoltage: { min: 4.5, max: 20, recommended: 5 },
  interfaces: ['digital'],
  pins: [
    pin('VCC', PIN_START_X, PIN_Y, 'vcc', {
      side: 'bottom',
      description: '4.5–20 V supply',
      voltage: 5,
    }),
    pin('OUT', PIN_START_X + PIN_PITCH, PIN_Y, 'digital', {
      side: 'bottom',
      direction: 'output',
      description: '3.3 V logic high while motion is detected',
    }),
    pin('GND', PIN_START_X + PIN_PITCH * 2, PIN_Y, 'gnd', {
      side: 'bottom',
      description: 'Ground reference',
    }),
  ],
  properties: PROPERTIES,
  render: { draw },
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
