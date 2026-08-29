import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, PART } from '../core/device-palette';
import { silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, group, line, path, rect, text, type Shape } from '../core/device-shape';
import {
  propertyNumber,
  propertyString,
  type DeviceBehavior,
} from '../core/device-simulation';

/**
 * RV09-style 9 mm vertical pot: a 9.5 mm phenolic case on three lugs at 0.1 in
 * pitch. The case is only twice the width of its own lug spacing, which is why
 * a real one looks so much smaller in a circuit than the knob it usually wears.
 */
const BODY = bodyFromMm({ widthMm: 11, heightMm: 15 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
const BODY_R = u(4.75);
const CENTER_X = WIDTH / 2;
const CENTER_Y = u(5.5);
const PIN_Y = HEIGHT;
const PIN_START_X = CENTER_X - HEADER_PITCH;

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
      line(
        PIN_START_X + index * HEADER_PITCH,
        CENTER_Y + BODY_R - u(0.8),
        PIN_START_X + index * HEADER_PITCH,
        PIN_Y,
        { stroke: PART.metal, strokeWidth: u(0.45), strokeLinecap: 'round' },
      ),
    ),

    // Blue phenolic case with the metal shaft collar.
    circle(CENTER_X, CENTER_Y, BODY_R, {
      fill: '#2f6fbf',
      stroke: OUTLINE,
      strokeWidth: u(0.15),
    }),
    circle(CENTER_X, CENTER_Y, BODY_R - u(0.9), {
      fill: '#2a63ab',
      stroke: '#20508d',
      strokeWidth: u(0.1),
      detail: 'normal',
    }),
    // 6 mm shaft collar.
    circle(CENTER_X, CENTER_Y, u(3), {
      fill: PART.metalLight,
      stroke: PART.metalDark,
      strokeWidth: u(0.15),
    }),

    // Knob indicator — rotates with the wiper so the position is readable
    // straight off the canvas.
    group(
      [
        line(0, 0, 0, -u(2.4), {
          stroke: '#1f2937',
          strokeWidth: u(0.5),
          strokeLinecap: 'round',
        }),
      ],
      { transform: `translate(${CENTER_X} ${CENTER_Y}) rotate(${angle})` },
    ),

    // Travel arc.
    path(
      `M ${CENTER_X - u(2.7)} ${CENTER_Y + u(2.1)} A ${u(3.4)} ${u(3.4)} 0 0 1 ${
        CENTER_X + u(2.7)
      } ${CENTER_Y + u(2.1)}`,
      { fill: 'none', stroke: '#93c5fd', strokeWidth: u(0.2), opacity: 0.7, detail: 'high' },
    ),

    silkLabel(CENTER_X, CENTER_Y + BODY_R - u(0.9), `${Math.round(position)}%`, {
      size: u(1.1),
      fill: '#e6f0ff',
      weight: 700,
      detail: 'normal',
    }),

    text(CENTER_X, HEIGHT - u(0.3), `${formatOhms(wiper)}/${formatOhms(total)}`, {
      size: u(0.95),
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
  ...BODY,
  initiallyVisible: false,
  interfaces: ['analog', 'passive'],
  pins: [
    pin('1', PIN_START_X, PIN_Y, 'passive', {
      side: 'bottom',
      description: 'End terminal, commonly tied to GND',
    }),
    pin('WIPER', PIN_START_X + HEADER_PITCH, PIN_Y, 'analog', {
      side: 'bottom',
      direction: 'output',
      description: 'Wiper output, feed this to an ADC pin',
    }),
    pin('3', PIN_START_X + HEADER_PITCH * 2, PIN_Y, 'passive', {
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
