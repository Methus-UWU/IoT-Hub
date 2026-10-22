import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { u } from '../core/device-metrics';
import { mixHex, OUTLINE, PART, SILK } from '../core/device-palette';
import { circle, path, rect, text, type Shape } from '../core/device-shape';
import { propertyNumber, type DeviceBehavior } from '../core/device-simulation';
import { createComparatorModule } from './comparator-module';

/**
 * YG1006 infrared flame sensor.
 *
 * The head is a black-epoxy IR photodiode aimed forward at about 60°. It
 * responds to the 760-1100 nm band a flame emits, so the modelled input here is
 * flame intensity rather than visible light: a bright room does not trip it.
 */

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'flame',
    label: 'Flame intensity',
    kind: 'number',
    defaultValue: 0,
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    description: 'Infrared energy reaching the photodiode, as a share of full scale.',
  },
  {
    id: 'thresholdFlame',
    label: 'Digital threshold',
    kind: 'number',
    defaultValue: 30,
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    description: 'Trimmer setting above which DO switches low.',
  },
];

/** The photodiode conducts under IR, so more flame means a lower analog level. */
export function flameAnalogVoltage(intensityPercent: number, rail = 3.3): number {
  const clamped = Math.min(Math.max(intensityPercent, 0), 100);
  return rail * (1 - clamped / 100);
}

export function flameDetected(intensityPercent: number, thresholdPercent: number): boolean {
  return intensityPercent >= thresholdPercent;
}

function head(context: DeviceDrawContext): readonly Shape[] {
  const flame = numberState(context, 'flame', 0);
  const level = Math.min(Math.max(flame / 100, 0), 1);
  const lens =
    context.running && context.state['powered'] === true
      ? mixHex('#1b1d22', '#c2410c', level)
      : '#1b1d22';

  return [
    // Two leads running back to the board, then the epoxy dome itself.
    ...[u(6), u(9)].map((y) =>
      rect(u(1.2), y - u(0.22), u(3.4), u(0.44), {
        fill: PART.metal,
        stroke: PART.metalDark,
        strokeWidth: u(0.06),
        detail: 'normal',
      }),
    ),
    circle(u(6.4), u(7.5), u(2.9), {
      fill: '#101216',
      stroke: '#05070a',
      strokeWidth: u(0.18),
    }),
    circle(u(6.4), u(7.5), u(2.1), {
      fill: lens,
      stroke: '#2a2d33',
      strokeWidth: u(0.12),
    }),
    circle(u(5.6), u(6.7), u(0.6), {
      fill: '#5b6068',
      opacity: 0.7,
      detail: 'high',
    }),
    // A small flame glyph on the silkscreen so the part is identifiable when
    // the head is drawn dark and cold.
    path(
      `M ${u(6.4)} ${u(11.6)} q ${u(1.6)} ${u(1.3)} 0 ${u(2.4)} q ${u(-1.6)} ${u(-1.1)} 0 ${u(-2.4)} Z`,
      {
        fill: level > 0 ? '#f59e0b' : SILK.dim,
        stroke: OUTLINE,
        strokeWidth: u(0.06),
        detail: 'high',
      },
    ),
    text(u(6.4), u(3.2), 'IR', {
      size: u(0.75),
      fill: SILK.white,
      anchor: 'middle',
      mono: true,
      weight: 700,
      detail: 'normal',
    }),
  ];
}

function createBehavior(): DeviceBehavior {
  return {
    drive(context) {
      const flame = propertyNumber(context, 'flame', 0);
      const threshold = propertyNumber(context, 'thresholdFlame', 30);
      context.drive('AO', flameAnalogVoltage(flame), 'strong');
      context.drive('DO', flameDetected(flame, threshold) ? 0 : 3.3, 'strong');
    },
    update(context) {
      const flame = propertyNumber(context, 'flame', 0);
      const threshold = propertyNumber(context, 'thresholdFlame', 30);
      context.emit('analogVoltage', flameAnalogVoltage(flame));
      context.emit('flameDetected', flameDetected(flame, threshold));
    },
  };
}

export const FLAME_SENSOR: VirtualDevice = createComparatorModule({
  id: 'flame-sensor',
  name: 'Flame sensor',
  model: 'YG1006 + LM393',
  description: 'Infrared flame detector with analog level and adjustable alarm output.',
  x: 700,
  y: 490,
  silk: 'FLAME',
  pins: [
    { name: 'VCC', type: 'vcc', description: '3.3-5 V supply' },
    { name: 'GND', type: 'gnd', description: 'Ground reference' },
    { name: 'DO', type: 'digital', description: 'Low while a flame is detected', output: true },
    { name: 'AO', type: 'analog', description: 'Analog infrared level', output: true },
  ],
  head,
  triggered: (context) =>
    flameDetected(numberState(context, 'flame', 0), numberState(context, 'thresholdFlame', 30)),
  properties: PROPERTIES,
  simulation: createBehavior,
  interfaces: ['analog', 'digital', 'power'],
  categoryId: 'sensors',
  category: 'Sensors',
  aliases: ['flame sensor', 'fire sensor', 'yg1006', 'เซนเซอร์เปลวไฟ', 'ตรวจจับไฟ'],
  tags: ['flame', 'fire', 'infrared', 'ir', 'analog', 'digital', 'sensor', 'safety'],
  interfaceLabel: 'Analog / digital · 4 pins',
  typicalUsage: 'Fire alarms, flame detection, and safety cut-off projects.',
});
