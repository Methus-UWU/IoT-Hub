import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { OUTLINE, PART } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, line, path, text, type Shape } from '../core/device-shape';

const WIDTH = 110;
const HEIGHT = 128;
const CENTER_X = WIDTH / 2;
const FACE_Y = 46;
const FACE_R = 40;
const LEG_Y = HEIGHT;
const LEG_SPAN = 22;

/**
 * Light-dependent resistor.
 *
 * Resistance falls as illuminance rises, following the standard log-log
 * response: R ≈ R₁₀ · (lux/10)^-γ. Modelling it properly means a divider built
 * around this part behaves the way it would on a bench.
 */
export function ldrResistance(lux: number, resistanceAt10Lux = 10_000, gamma = 0.7): number {
  const safeLux = Math.max(lux, 0.1);
  return resistanceAt10Lux * (safeLux / 10) ** -gamma;
}

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'lux',
    label: 'Light level',
    kind: 'number',
    defaultValue: 300,
    min: 0.1,
    max: 20_000,
    step: 1,
    unit: 'lux',
    group: 'simulation',
    description: 'Ambient illuminance falling on the sensor face.',
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
    description: 'Datasheet reference point for the cell.',
  },
];

function draw(context: DeviceDrawContext): readonly Shape[] {
  const lux = numberState(context, 'lux', 300);
  const reference = numberState(context, 'darkResistance', 10_000);
  const ohms = ldrResistance(lux, reference);
  // The cadmium sulfide face visibly pales under strong light.
  const brightness = Math.min(lux / 1000, 1);

  return [
    // Legs.
    line(CENTER_X - LEG_SPAN, FACE_Y + 20, CENTER_X - LEG_SPAN, LEG_Y, {
      stroke: PART.metal,
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),
    line(CENTER_X + LEG_SPAN, FACE_Y + 20, CENTER_X + LEG_SPAN, LEG_Y, {
      stroke: PART.metal,
      strokeWidth: 4,
      strokeLinecap: 'round',
    }),

    // Ceramic disc.
    circle(CENTER_X, FACE_Y, FACE_R, {
      fill: '#d9d2bd',
      stroke: OUTLINE,
      strokeWidth: 1.5,
    }),
    circle(CENTER_X, FACE_Y, FACE_R - 7, {
      fill: brightness > 0.5 ? '#f0d98a' : '#c8a94e',
      opacity: 0.85,
    }),

    // The serpentine CdS track — the shape that makes an LDR recognisable.
    path(
      `M ${CENTER_X - 26} ${FACE_Y - 20}
       q 13 10 0 20 q -13 10 0 20
       M ${CENTER_X - 9} ${FACE_Y - 24}
       q 13 12 0 24 q -13 12 0 24
       M ${CENTER_X + 9} ${FACE_Y - 24}
       q 13 12 0 24 q -13 12 0 24`,
      { fill: 'none', stroke: '#4a3f24', strokeWidth: 3.5, strokeLinecap: 'round' },
    ),

    text(CENTER_X, HEIGHT - 4, formatOhms(ohms), {
      size: 11,
      fill: '#6b7280',
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
  ];
}

function formatOhms(ohms: number): string {
  if (ohms >= 1_000_000) return `${(ohms / 1_000_000).toFixed(1)} MΩ`;
  if (ohms >= 1_000) return `${(ohms / 1_000).toFixed(1)} kΩ`;
  return `${Math.round(ohms)} Ω`;
}

/** GL5528-style light-dependent resistor. */
export const LDR: VirtualDevice = {
  id: 'ldr',
  name: 'Photoresistor (LDR)',
  model: 'GL5528',
  description: 'Resistance drops as light increases. Pair with a fixed resistor as a divider.',
  x: 720,
  y: 520,
  width: WIDTH,
  height: HEIGHT,
  initiallyVisible: false,
  rotatable: true,
  interfaces: ['analog', 'passive'],
  pins: [
    pin('1', CENTER_X - LEG_SPAN, LEG_Y, 'passive', {
      side: 'bottom',
      description: 'Photocells are not polarised',
    }),
    pin('2', CENTER_X + LEG_SPAN, LEG_Y, 'passive', {
      side: 'bottom',
      description: 'Photocells are not polarised',
    }),
  ],
  properties: PROPERTIES,
  render: { draw },
  catalog: {
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: ['ldr', 'photoresistor', 'light sensor', 'ตัวต้านทานแสง', 'cds cell'],
    tags: ['ldr', 'light', 'photoresistor', 'analog', 'sensor', 'cds', 'ambient'],
    interfaceLabel: 'แอนะล็อก · 2 ขา',
    typicalUsage: 'Automatic night lights, brightness control, and daylight detection.',
  },
};
