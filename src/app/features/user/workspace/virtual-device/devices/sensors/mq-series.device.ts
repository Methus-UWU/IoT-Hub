import type { VirtualDevice } from '../../models/virtual-device.model';
import { createMqSensor } from './mq-sensor';

/**
 * The other MQ sensors people build projects around.
 *
 * Each is the MQ-2's can with a differently doped bead, so each is only its
 * detection window, its default alarm point, and what it responds to. Windows
 * are the datasheet ranges; the MQ-3's is converted from mg/L of alcohol vapour
 * at roughly 500 ppm per mg/L.
 */

export const MQ135_AIR: VirtualDevice = createMqSensor({
  id: 'mq135-air',
  name: 'MQ-135 air quality sensor',
  model: 'MQ-135 + LM393',
  description: 'Responds to ammonia, benzene, alcohol and smoke as one air quality level.',
  x: 700,
  y: 340,
  silk: 'MQ-135',
  minPpm: 10,
  maxPpm: 1000,
  step: 1,
  defaultPpm: 60,
  defaultThresholdPpm: 300,
  concentrationDescription:
    'Combined concentration of ammonia, benzene, alcohol and smoke. The sensor cannot tell them apart.',
  aliases: ['mq-135', 'mq135', 'air quality sensor', 'เซนเซอร์คุณภาพอากาศ', 'เซนเซอร์วัดมลพิษ'],
  tags: ['gas', 'air quality', 'mq135', 'ammonia', 'benzene', 'analog', 'digital', 'sensor'],
  typicalUsage: 'Indoor air quality monitors and automatic ventilation fans.',
});

export const MQ7_CO: VirtualDevice = createMqSensor({
  id: 'mq7-co',
  name: 'MQ-7 carbon monoxide sensor',
  model: 'MQ-7 + LM393',
  description: 'Detects carbon monoxide from engines, stoves and generators.',
  x: 700,
  y: 360,
  silk: 'MQ-7',
  minPpm: 20,
  maxPpm: 2000,
  step: 5,
  defaultPpm: 30,
  defaultThresholdPpm: 200,
  concentrationDescription: 'Carbon monoxide concentration around the sensor.',
  aliases: ['mq-7', 'mq7', 'co sensor', 'carbon monoxide', 'เซนเซอร์คาร์บอนมอนอกไซด์'],
  tags: ['gas', 'co', 'carbon monoxide', 'mq7', 'analog', 'digital', 'sensor', 'safety'],
  typicalUsage: 'Carbon monoxide alerts in garages, kitchens, and generator rooms.',
});

export const MQ3_ALCOHOL: VirtualDevice = createMqSensor({
  id: 'mq3-alcohol',
  name: 'MQ-3 alcohol sensor',
  model: 'MQ-3 + LM393',
  description: 'Detects alcohol vapour in the air or in breath.',
  x: 700,
  y: 380,
  silk: 'MQ-3',
  minPpm: 20,
  maxPpm: 2000,
  step: 5,
  defaultPpm: 40,
  defaultThresholdPpm: 400,
  concentrationDescription: 'Alcohol vapour concentration around the sensor.',
  aliases: ['mq-3', 'mq3', 'alcohol sensor', 'breathalyzer', 'เซนเซอร์แอลกอฮอล์'],
  tags: ['gas', 'alcohol', 'ethanol', 'mq3', 'breath', 'analog', 'digital', 'sensor'],
  typicalUsage: 'Breath alcohol demos and alcohol vapour alerts.',
});
