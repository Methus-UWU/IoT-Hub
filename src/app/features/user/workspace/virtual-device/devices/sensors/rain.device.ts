import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { u } from '../core/device-metrics';
import { mixHex, OUTLINE, PART, SILK } from '../core/device-palette';
import { circle, line, rect, text, type Shape } from '../core/device-shape';
import { propertyNumber, type DeviceBehavior } from '../core/device-simulation';
import { createComparatorModule } from './comparator-module';

/**
 * YL-83 rain / water drop sensor.
 *
 * The comparator board is sold with a separate interdigitated collector plate;
 * water bridging its combs drops the resistance between them. The board here
 * carries the two-screw terminal that plate lands on, and the modelled input is
 * how much of the plate is wet.
 */

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'wetness',
    label: 'Plate wetness',
    kind: 'number',
    defaultValue: 0,
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    description: 'Share of the collector plate covered by water.',
  },
  {
    id: 'thresholdWetness',
    label: 'Digital threshold',
    kind: 'number',
    defaultValue: 25,
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    description: 'Trimmer setting above which DO switches low.',
  },
];

/** A dry plate is an open circuit, so the analog output sits at the rail. */
export function rainAnalogVoltage(wetnessPercent: number, rail = 3.3): number {
  const clamped = Math.min(Math.max(wetnessPercent, 0), 100);
  return rail * (1 - clamped / 100);
}

export function rainDetected(wetnessPercent: number, thresholdPercent: number): boolean {
  return wetnessPercent >= thresholdPercent;
}

function head(context: DeviceDrawContext): readonly Shape[] {
  const wetness = numberState(context, 'wetness', 0);
  const level = Math.min(Math.max(wetness / 100, 0), 1);
  const film = mixHex('#1c3f6d', '#3b82f6', level);

  return [
    rect(u(1.4), u(3.2), u(8.8), u(8.6), {
      rx: u(0.4),
      fill: '#123b6b',
      stroke: '#0a2547',
      strokeWidth: u(0.16),
    }),
    // Two screw pads for the collector plate leads.
    ...[u(4.3), u(7.3)]
      .map((x) => [
        circle(x, u(5.4), u(1.25), {
          fill: PART.metal,
          stroke: PART.metalDark,
          strokeWidth: u(0.14),
        }),
        line(x - u(0.7), u(5.4), x + u(0.7), u(5.4), {
          stroke: '#5d666f',
          strokeWidth: u(0.28),
          strokeLinecap: 'round',
          detail: 'normal',
        }),
      ])
      .flat(),
    // The wet film, shown as the interdigitated comb filling with water.
    rect(u(2.4), u(7.6), u(6.8), u(3.4), {
      rx: u(0.25),
      fill: film,
      stroke: OUTLINE,
      strokeWidth: u(0.1),
    }),
    ...Array.from({ length: 5 }, (_, index) =>
      line(u(3.1) + index * u(1.4), u(7.9), u(3.1) + index * u(1.4), u(10.7), {
        stroke: PART.copper,
        strokeWidth: u(0.26),
        opacity: 0.85,
        detail: 'normal',
      }),
    ),
    text(u(5.8), u(2.5), 'RAIN', {
      size: u(0.75),
      fill: SILK.white,
      anchor: 'middle',
      mono: true,
      weight: 700,
      detail: 'normal',
    }),
    text(u(5.8), u(13.2), `${Math.round(wetness)}%`, {
      size: u(0.8),
      fill: SILK.soft,
      anchor: 'middle',
      mono: true,
      weight: 700,
      detail: 'high',
    }),
  ];
}

function createBehavior(): DeviceBehavior {
  return {
    drive(context) {
      const wetness = propertyNumber(context, 'wetness', 0);
      const threshold = propertyNumber(context, 'thresholdWetness', 25);
      context.drive('AO', rainAnalogVoltage(wetness), 'strong');
      context.drive('DO', rainDetected(wetness, threshold) ? 0 : 3.3, 'strong');
    },
    update(context) {
      const wetness = propertyNumber(context, 'wetness', 0);
      const threshold = propertyNumber(context, 'thresholdWetness', 25);
      context.emit('analogVoltage', rainAnalogVoltage(wetness));
      context.emit('rainDetected', rainDetected(wetness, threshold));
    },
  };
}

export const RAIN_SENSOR: VirtualDevice = createComparatorModule({
  id: 'rain-sensor',
  name: 'Rain sensor',
  model: 'YL-83 + LM393',
  description: 'Detects rain or water on a collector plate with analog and digital outputs.',
  x: 700,
  y: 660,
  silk: 'RAIN YL-83',
  pins: [
    { name: 'VCC', type: 'vcc', description: '3.3-5 V supply' },
    { name: 'GND', type: 'gnd', description: 'Ground reference' },
    { name: 'DO', type: 'digital', description: 'Low once the plate is wet enough', output: true },
    { name: 'AO', type: 'analog', description: 'Analog wetness level', output: true },
  ],
  head,
  triggered: (context) =>
    rainDetected(numberState(context, 'wetness', 0), numberState(context, 'thresholdWetness', 25)),
  properties: PROPERTIES,
  simulation: createBehavior,
  interfaces: ['analog', 'digital', 'power'],
  categoryId: 'sensors',
  category: 'Sensors',
  aliases: ['rain sensor', 'water sensor', 'yl-83', 'เซนเซอร์น้ำฝน', 'ตรวจจับฝน'],
  tags: ['rain', 'water', 'weather', 'analog', 'digital', 'sensor', 'yl-83'],
  interfaceLabel: 'Analog / digital · 4 pins',
  typicalUsage: 'Weather stations, automatic awnings, and leak detection projects.',
});
