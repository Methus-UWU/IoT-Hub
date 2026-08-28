import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { OUTLINE, PART } from '../core/device-palette';
import { PIN_PITCH, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, group, line, path, rect, text, type Shape } from '../core/device-shape';
import {
  propertyNumber,
  propertyString,
  type DeviceBehavior,
} from '../core/device-simulation';

const WIDTH = 140;
const HEIGHT = 150;
const BODY_Y = 18;
const BODY_R = 52;
const CENTER_X = WIDTH / 2;
const CENTER_Y = BODY_Y + BODY_R;
const PIN_Y = HEIGHT;
const PIN_START_X = CENTER_X - PIN_PITCH;

/** Rotation limits of a standard single-turn pot, in degrees from vertical. */
const SWEEP = 135;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'position',
    label: 'Wiper position',
    kind: 'number',
    defaultValue: 50,
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    description: 'Where the wiper sits between the two end terminals.',
  },
  {
    id: 'resistance',
    label: 'Total resistance',
    kind: 'number',
    defaultValue: 10_000,
    min: 100,
    max: 1_000_000,
    step: 100,
    unit: 'Ω',
    group: 'electrical',
  },
  {
    id: 'taper',
    label: 'Taper',
    kind: 'select',
    defaultValue: 'linear',
    group: 'electrical',
    options: [
      { value: 'linear', label: 'Linear (B)' },
      { value: 'log', label: 'Logarithmic (A)' },
    ],
  },
];

/** Wiper resistance for a given travel, honouring the taper curve. */
export function wiperResistance(total: number, positionPercent: number, taper: string): number {
  const travel = Math.min(Math.max(positionPercent, 0), 100) / 100;
  const curve = taper === 'log' ? travel ** 2.5 : travel;
  return total * curve;
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const position = numberState(context, 'position', 50);
  const total = numberState(context, 'resistance', 10_000);
  const angle = -SWEEP + (position / 100) * SWEEP * 2;
  const wiper = wiperResistance(total, position, String(context.state['taper'] ?? 'linear'));

  return [
    // Solder lugs.
    ...[0, 1, 2].map((index) =>
      line(PIN_START_X + index * PIN_PITCH, CENTER_Y + BODY_R - 8, PIN_START_X + index * PIN_PITCH, PIN_Y, {
        stroke: PART.metal,
        strokeWidth: 4,
        strokeLinecap: 'round',
      }),
    ),

    // Blue phenolic case with the metal shaft collar.
    circle(CENTER_X, CENTER_Y, BODY_R, {
      fill: '#2f6fbf',
      stroke: OUTLINE,
      strokeWidth: 1.5,
    }),
    circle(CENTER_X, CENTER_Y, BODY_R - 9, {
      fill: '#2a63ab',
      stroke: '#20508d',
      strokeWidth: 1,
      detail: 'normal',
    }),
    circle(CENTER_X, CENTER_Y, 22, {
      fill: PART.metalLight,
      stroke: PART.metalDark,
      strokeWidth: 1.5,
    }),

    // Knob indicator — rotates with the wiper so the position is readable
    // straight off the canvas.
    group(
      [
        line(0, 0, 0, -16, {
          stroke: '#1f2937',
          strokeWidth: 4,
          strokeLinecap: 'round',
        }),
      ],
      { transform: `translate(${CENTER_X} ${CENTER_Y}) rotate(${angle})` },
    ),

    // Travel arc.
    path(
      `M ${CENTER_X - 34} ${CENTER_Y + 26} A 42 42 0 0 1 ${CENTER_X + 34} ${CENTER_Y + 26}`,
      { fill: 'none', stroke: '#93c5fd', strokeWidth: 2, opacity: 0.7, detail: 'high' },
    ),

    silkLabel(CENTER_X, CENTER_Y + BODY_R - 16, `${Math.round(position)}%`, {
      size: 11,
      fill: '#e6f0ff',
      weight: 700,
    }),

    text(CENTER_X, HEIGHT - 2, `${formatOhms(wiper)} / ${formatOhms(total)}`, {
      size: 9.5,
      fill: '#6b7280',
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'high',
    }),
  ];
}

function formatOhms(ohms: number): string {
  if (ohms >= 1_000_000) return `${(ohms / 1_000_000).toFixed(1)}M`;
  if (ohms >= 1_000) return `${(ohms / 1_000).toFixed(1)}k`;
  return `${Math.round(ohms)}`;
}

/** Single-turn rotary potentiometer wired as a three-terminal divider. */
export const POTENTIOMETER: VirtualDevice = {
  id: 'potentiometer',
  name: 'Potentiometer',
  model: 'RV09 10 kΩ',
  description: 'Rotary voltage divider. The wiper reads between the two end terminals.',
  x: 520,
  y: 640,
  width: WIDTH,
  height: HEIGHT,
  initiallyVisible: false,
  interfaces: ['analog', 'passive'],
  pins: [
    pin('1', PIN_START_X, PIN_Y, 'passive', {
      side: 'bottom',
      description: 'End terminal, commonly tied to GND',
    }),
    pin('WIPER', PIN_START_X + PIN_PITCH, PIN_Y, 'analog', {
      side: 'bottom',
      direction: 'output',
      description: 'Wiper output, feed this to an ADC pin',
    }),
    pin('3', PIN_START_X + PIN_PITCH * 2, PIN_Y, 'passive', {
      side: 'bottom',
      description: 'End terminal, commonly tied to VCC',
    }),
  ],
  properties: PROPERTIES,
  render: { draw },
  catalog: {
    categoryId: 'input-devices',
    category: 'Input Devices',
    aliases: ['pot', 'potentiometer', 'variable resistor', 'ตัวต้านทานปรับค่า', 'knob'],
    tags: ['potentiometer', 'analog', 'input', 'divider', 'knob', 'variable', 'adc'],
    interfaceLabel: 'แอนะล็อก · 3 ขา',
    typicalUsage: 'Volume and brightness control, calibration, and analog test inputs.',
  },
};

/**
 * The wiper sits between the two end terminals, so its voltage is the terminal
 * voltages interpolated by travel — this is a divider, not a source. It drives
 * weakly so anything actually driving that net still wins.
 *
 * Reading its own inputs before driving is exactly why the solver relaxes
 * drive+resolve rather than running it once.
 */
function createPotentiometerBehavior(): DeviceBehavior {
  return {
    drive(context) {
      const low = context.readNode('1');
      const high = context.readNode('3');
      if (low.floating && high.floating) return;

      const travel = Math.min(Math.max(propertyNumber(context, 'position', 50), 0), 100) / 100;
      const taper = propertyString(context, 'taper', 'linear');
      const curve = taper === 'log' ? travel ** 2.5 : travel;
      const lowVolts = low.floating ? 0 : low.voltage;
      const highVolts = high.floating ? 0 : high.voltage;

      context.drive('WIPER', lowVolts + (highVolts - lowVolts) * curve, 'weak');
    },
    update(context) {
      const wiper = context.readNode('WIPER');
      context.emit('wiperVolts', wiper.floating ? 0 : Math.round(wiper.voltage * 100) / 100);
    },
  };
}

POTENTIOMETER.simulation = createPotentiometerBehavior;
