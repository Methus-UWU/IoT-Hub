import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { u } from '../core/device-metrics';
import { mixHex, OUTLINE, PART, SILK } from '../core/device-palette';
import { rect, text, type Shape } from '../core/device-shape';
import { propertyNumber, type DeviceBehavior } from '../core/device-simulation';
import { createComparatorModule } from './comparator-module';

/**
 * FC-28 soil moisture module.
 *
 * The board is the shared LM393 comparator breakout; what belongs to this part
 * is the two-screw probe terminal on the left and the response curve: a dry
 * probe reads near the supply rail and a soaked one reads near ground, which is
 * the opposite of what people expect until they measure it once.
 *
 * DO is active low, like the real module — it pulls down once moisture rises
 * above the trimmer threshold — so a sketch wired to it reads LOW for "wet".
 */

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'moisture',
    label: 'Soil moisture',
    kind: 'number',
    defaultValue: 35,
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    description: 'Volumetric water content around the probe.',
  },
  {
    id: 'thresholdMoisture',
    label: 'Digital threshold',
    kind: 'number',
    defaultValue: 45,
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    description: 'Trimmer setting above which DO switches low.',
  },
];

/** Dry soil sits near the rail, saturated soil near ground. */
export function soilAnalogVoltage(moisturePercent: number, rail = 3.3): number {
  const clamped = Math.min(Math.max(moisturePercent, 0), 100);
  return rail * (1 - clamped / 100);
}

export function soilIsWet(moisturePercent: number, thresholdPercent: number): boolean {
  return moisturePercent >= thresholdPercent;
}

function head(context: DeviceDrawContext): readonly Shape[] {
  const moisture = numberState(context, 'moisture', 35);
  const wetness = Math.min(Math.max(moisture / 100, 0), 1);
  // The terminal block itself never changes; the damp patch on the silkscreen
  // is what tells the user at a glance how wet the modelled soil is.
  const soil = mixHex('#8a6a44', '#3f2d1b', wetness);

  return [
    rect(u(1.4), u(3.4), u(8.6), u(8.2), {
      rx: u(0.4),
      fill: '#1a4a25',
      stroke: '#0e2d16',
      strokeWidth: u(0.16),
    }),
    ...[u(4.6), u(7.6)].map((x) =>
      rect(x - u(1), u(4.4), u(2), u(2), {
        rx: u(0.18),
        fill: PART.metal,
        stroke: PART.metalDark,
        strokeWidth: u(0.12),
        detail: 'normal',
      }),
    ),
    ...[u(4.6), u(7.6)].map((x) =>
      rect(x - u(0.9), u(7.2), u(1.8), u(3.4), {
        rx: u(0.2),
        fill: soil,
        stroke: OUTLINE,
        strokeWidth: u(0.1),
        detail: 'normal',
      }),
    ),
    text(u(5.7), u(2.6), 'PROBE', {
      size: u(0.72),
      fill: SILK.white,
      anchor: 'middle',
      mono: true,
      weight: 700,
      detail: 'normal',
    }),
    text(u(5.7), u(13.1), `${Math.round(moisture)}%`, {
      size: u(0.85),
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
      const moisture = propertyNumber(context, 'moisture', 35);
      const threshold = propertyNumber(context, 'thresholdMoisture', 45);
      context.drive('AO', soilAnalogVoltage(moisture), 'strong');
      context.drive('DO', soilIsWet(moisture, threshold) ? 0 : 3.3, 'strong');
    },
    update(context) {
      const moisture = propertyNumber(context, 'moisture', 35);
      const threshold = propertyNumber(context, 'thresholdMoisture', 45);
      context.emit('analogVoltage', soilAnalogVoltage(moisture));
      context.emit('wet', soilIsWet(moisture, threshold));
    },
  };
}

export const SOIL_MOISTURE: VirtualDevice = createComparatorModule({
  id: 'soil-moisture',
  name: 'Soil moisture sensor',
  model: 'FC-28 + LM393',
  description: 'Measures soil water content with an analog level and an adjustable wet/dry output.',
  x: 700,
  y: 150,
  silk: 'SOIL FC-28',
  pins: [
    { name: 'VCC', type: 'vcc', description: '3.3-5 V supply' },
    { name: 'GND', type: 'gnd', description: 'Ground reference' },
    {
      name: 'DO',
      type: 'digital',
      description: 'Low once moisture passes the threshold',
      output: true,
    },
    {
      name: 'AO',
      type: 'analog',
      description: 'Analog moisture level; falls as soil gets wetter',
      output: true,
    },
  ],
  head,
  triggered: (context) =>
    soilIsWet(numberState(context, 'moisture', 35), numberState(context, 'thresholdMoisture', 45)),
  properties: PROPERTIES,
  simulation: createBehavior,
  interfaces: ['analog', 'digital', 'power'],
  categoryId: 'sensors',
  category: 'Sensors',
  aliases: [
    'soil moisture',
    'soil sensor',
    'fc-28',
    'yl-69',
    'เซนเซอร์วัดความชื้นในดิน',
    'ความชื้นดิน',
    'moisture sensor',
  ],
  tags: ['soil', 'moisture', 'humidity', 'analog', 'digital', 'sensor', 'garden', 'irrigation'],
  interfaceLabel: 'Analog / digital · 4 pins',
  typicalUsage: 'Automatic plant watering, irrigation control, and soil monitoring projects.',
});
