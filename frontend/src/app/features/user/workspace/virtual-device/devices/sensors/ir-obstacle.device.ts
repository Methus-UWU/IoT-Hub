import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { u } from '../core/device-metrics';
import { PART, SILK } from '../core/device-palette';
import { circle, rect, text, type Shape } from '../core/device-shape';
import { propertyNumber, type DeviceBehavior } from '../core/device-simulation';
import { createComparatorModule } from './comparator-module';

/**
 * FC-51 infrared obstacle sensor.
 *
 * A clear IR emitter and a black IR receiver sit side by side; the trimmer sets
 * how much reflected light counts as an obstacle. The output is active low and
 * purely digital — the module has no analog pin, which is what separates it
 * from the sensors that share this board.
 */

const MAX_RANGE_CM = 30;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'distanceCm',
    label: 'Obstacle distance',
    kind: 'number',
    defaultValue: 20,
    min: 1,
    max: 60,
    step: 1,
    unit: 'cm',
    group: 'simulation',
    description: 'Distance to the nearest reflective surface in front of the sensor.',
  },
  {
    id: 'rangeCm',
    label: 'Trigger range',
    kind: 'number',
    defaultValue: 12,
    min: 2,
    max: MAX_RANGE_CM,
    step: 1,
    unit: 'cm',
    group: 'simulation',
    description: 'Trimmer setting: anything closer than this pulls OUT low.',
  },
];

export function obstacleDetected(distanceCm: number, rangeCm: number): boolean {
  return distanceCm <= rangeCm;
}

function head(context: DeviceDrawContext): readonly Shape[] {
  const distance = numberState(context, 'distanceCm', 20);
  const range = numberState(context, 'rangeCm', 12);
  const detected =
    context.running && context.state['powered'] === true && obstacleDetected(distance, range);

  return [
    // Emitter (clear) and receiver (black), each on two legs.
    ...[
      { x: u(3.4), body: detected ? '#93c5fd' : '#cfd8e3', rim: '#8a94a2', label: 'TX' },
      { x: u(8.4), body: '#15181d', rim: '#0a0c0f', label: 'RX' },
    ].flatMap(({ x, body, rim, label }) => [
      rect(x - u(0.9), u(10.4), u(0.42), u(2.6), {
        fill: PART.metal,
        stroke: PART.metalDark,
        strokeWidth: u(0.06),
        detail: 'normal',
      }),
      rect(x + u(0.5), u(10.4), u(0.42), u(2.6), {
        fill: PART.metal,
        stroke: PART.metalDark,
        strokeWidth: u(0.06),
        detail: 'normal',
      }),
      circle(x, u(7.1), u(2.2), {
        fill: body,
        stroke: rim,
        strokeWidth: u(0.18),
      }),
      circle(x - u(0.6), u(6.4), u(0.5), {
        fill: '#ffffff',
        opacity: 0.45,
        detail: 'high',
      }),
      text(x, u(3.3), label, {
        size: u(0.72),
        fill: SILK.white,
        anchor: 'middle',
        mono: true,
        weight: 700,
        detail: 'normal',
      }),
    ]),
    text(u(5.9), u(14), detected ? 'OBSTACLE' : `${Math.round(distance)} cm`, {
      size: u(0.76),
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
      const distance = propertyNumber(context, 'distanceCm', 20);
      const range = propertyNumber(context, 'rangeCm', 12);
      context.drive('OUT', obstacleDetected(distance, range) ? 0 : 3.3, 'strong');
    },
    update(context) {
      const distance = propertyNumber(context, 'distanceCm', 20);
      const range = propertyNumber(context, 'rangeCm', 12);
      context.emit('obstacle', obstacleDetected(distance, range));
    },
  };
}

export const IR_OBSTACLE: VirtualDevice = createComparatorModule({
  id: 'ir-obstacle',
  name: 'IR obstacle sensor',
  model: 'FC-51',
  description: 'Reflective infrared obstacle detector with an adjustable trigger range.',
  x: 880,
  y: 320,
  silk: 'FC-51',
  pins: [
    { name: 'VCC', type: 'vcc', description: '3.3-5 V supply' },
    { name: 'GND', type: 'gnd', description: 'Ground reference' },
    {
      name: 'OUT',
      type: 'digital',
      description: 'Low while an obstacle is in range',
      output: true,
    },
  ],
  head,
  triggered: (context) =>
    obstacleDetected(numberState(context, 'distanceCm', 20), numberState(context, 'rangeCm', 12)),
  properties: PROPERTIES,
  simulation: createBehavior,
  interfaces: ['digital', 'power'],
  categoryId: 'sensors',
  category: 'Sensors',
  aliases: [
    'ir obstacle',
    'obstacle sensor',
    'fc-51',
    'infrared sensor',
    'เซนเซอร์กันชน',
    'ตรวจจับสิ่งกีดขวาง',
  ],
  tags: ['infrared', 'ir', 'obstacle', 'proximity', 'digital', 'sensor', 'robot', 'line'],
  interfaceLabel: 'Digital · 3 pins',
  typicalUsage: 'Line-following robots, obstacle avoidance, and object counting.',
});
