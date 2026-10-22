import type { VirtualDevice } from '../../models/virtual-device.model';
import { createMqSensor } from './mq-sensor';

/**
 * MQ-2 combustible gas and smoke sensor.
 *
 * The widest window in the MQ family, from a few hundred ppm to one percent: it
 * answers "is there LPG, methane or smoke in the air", not "how much". The can,
 * the curve and the board come from [mq-sensor.ts].
 */
export const MQ2_GAS: VirtualDevice = createMqSensor({
  id: 'mq2-gas',
  name: 'MQ-2 gas sensor',
  model: 'MQ-2 + LM393',
  description: 'Detects smoke, LPG, methane and other combustible gases.',
  x: 700,
  y: 320,
  silk: 'MQ-2',
  minPpm: 200,
  maxPpm: 10_000,
  step: 10,
  defaultPpm: 400,
  defaultThresholdPpm: 1000,
  concentrationDescription: 'Combustible gas or smoke concentration around the sensor.',
  aliases: ['mq-2', 'mq2', 'gas sensor', 'smoke sensor', 'เซนเซอร์แก๊ส', 'เซนเซอร์ควัน'],
  tags: ['gas', 'smoke', 'mq2', 'lpg', 'methane', 'analog', 'digital', 'sensor', 'safety'],
  typicalUsage: 'Smoke alarms, gas leak detection, and air quality alerting projects.',
});
