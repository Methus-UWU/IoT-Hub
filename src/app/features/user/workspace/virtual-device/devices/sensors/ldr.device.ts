import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, PART } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, line, path, text, type Shape } from '../core/device-shape';

/**
 * GL5528 light-dependent resistor.
 *
 * A 5 mm ceramic disc on two 0.1 in-pitch legs. The serpentine cadmium sulfide
 * track across the face is what makes this part recognisable at a glance, so it
 * is drawn to the same three-finger pattern the real cell uses rather than as a
 * generic squiggle.
 */

const BODY = bodyFromMm({ widthMm: 6, heightMm: 12 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
const CENTER_X = WIDTH / 2;

/** 5 mm disc, sitting just above the legs. */
const FACE_Y = u(3);
const FACE_R = u(2.5);
const LEG_HALF_PITCH = HEADER_PITCH / 2;

/**
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
    ...[-LEG_HALF_PITCH, LEG_HALF_PITCH].map((offset) =>
      line(CENTER_X + offset, FACE_Y + u(1.5), CENTER_X + offset, HEIGHT, {
        stroke: PART.metal,
        strokeWidth: u(0.5),
        strokeLinecap: 'round',
      }),
    ),

    // Ceramic disc and its resin face.
    circle(CENTER_X, FACE_Y, FACE_R, {
      fill: '#d9d2bd',
      stroke: OUTLINE,
      strokeWidth: u(0.15),
    }),
    circle(CENTER_X, FACE_Y, FACE_R - u(0.45), {
      fill: brightness > 0.5 ? '#f0d98a' : '#c8a94e',
      opacity: 0.85,
    }),

    // The serpentine CdS track.
    path(
      `M ${CENTER_X - u(1.6)} ${FACE_Y - u(1.25)}` +
        ` q ${u(0.8)} ${u(0.62)} 0 ${u(1.25)} q ${-u(0.8)} ${u(0.62)} 0 ${u(1.25)}` +
        ` M ${CENTER_X - u(0.55)} ${FACE_Y - u(1.5)}` +
        ` q ${u(0.8)} ${u(0.75)} 0 ${u(1.5)} q ${-u(0.8)} ${u(0.75)} 0 ${u(1.5)}` +
        ` M ${CENTER_X + u(0.55)} ${FACE_Y - u(1.5)}` +
        ` q ${u(0.8)} ${u(0.75)} 0 ${u(1.5)} q ${-u(0.8)} ${u(0.75)} 0 ${u(1.5)}`,
      { fill: 'none', stroke: '#4a3f24', strokeWidth: u(0.22), strokeLinecap: 'round' },
    ),

    text(CENTER_X, HEIGHT - u(0.3), formatOhms(ohms), {
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
  if (ohms >= 1_000_000) return `${(ohms / 1_000_000).toFixed(1)} MΩ`;
  if (ohms >= 1_000) return `${(ohms / 1_000).toFixed(1)} kΩ`;
  return `${Math.round(ohms)} Ω`;
}

export const LDR: VirtualDevice = {
  id: 'ldr',
  name: 'Photoresistor (LDR)',
  model: 'GL5528',
  description: 'Resistance drops as light increases. Pair with a fixed resistor as a divider.',
  x: 720,
  y: 520,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  interfaces: ['analog', 'passive'],
  pins: [
    pin('1', CENTER_X - LEG_HALF_PITCH, HEIGHT, 'passive', {
      side: 'bottom',
      description: 'Photocells are not polarised',
    }),
    pin('2', CENTER_X + LEG_HALF_PITCH, HEIGHT, 'passive', {
      side: 'bottom',
      description: 'Photocells are not polarised',
    }),
  ],
  properties: PROPERTIES,
  render: { draw, bleed: { left: u(2), right: u(2) } },
  catalog: {
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: ['ldr', 'photoresistor', 'light sensor', 'ตัวต้านทานแสง', 'cds cell'],
    tags: ['ldr', 'light', 'photoresistor', 'analog', 'sensor', 'cds', 'ambient'],
    interfaceLabel: 'แอนะล็อก · 2 ขา',
    typicalUsage: 'Automatic night lights, brightness control, and daylight detection.',
  },
};
