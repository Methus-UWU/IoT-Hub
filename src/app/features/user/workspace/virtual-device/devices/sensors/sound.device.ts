import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { u } from '../core/device-metrics';
import { mixHex, PART, SILK } from '../core/device-palette';
import { circle, rect, text, type Shape } from '../core/device-shape';
import { propertyNumber, type DeviceBehavior } from '../core/device-simulation';
import { createComparatorModule } from './comparator-module';

/**
 * KY-038 sound detection module.
 *
 * An electret capsule feeds the LM393. What the module reports is loudness, not
 * audio: AO carries the envelope and DO snaps low each time a sound crosses the
 * trimmer threshold. Treating it as a microphone is the usual first mistake.
 */

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'loudness',
    label: 'Sound level',
    kind: 'number',
    defaultValue: 45,
    min: 30,
    max: 120,
    step: 1,
    unit: 'dB',
    group: 'simulation',
    description: 'Sound pressure level reaching the electret capsule.',
  },
  {
    id: 'thresholdLoudness',
    label: 'Digital threshold',
    kind: 'number',
    defaultValue: 70,
    min: 30,
    max: 120,
    step: 1,
    unit: 'dB',
    group: 'simulation',
    description: 'Trimmer setting above which DO switches low.',
  },
];

const MIN_DB = 30;
const MAX_DB = 120;

/** The envelope detector output rises with level across the usable range. */
export function soundAnalogVoltage(decibels: number, rail = 3.3): number {
  const clamped = Math.min(Math.max(decibels, MIN_DB), MAX_DB);
  return (rail * (clamped - MIN_DB)) / (MAX_DB - MIN_DB);
}

export function soundDetected(decibels: number, thresholdDecibels: number): boolean {
  return decibels >= thresholdDecibels;
}

function head(context: DeviceDrawContext): readonly Shape[] {
  const loudness = numberState(context, 'loudness', 45);
  const level = Math.min(Math.max((loudness - MIN_DB) / (MAX_DB - MIN_DB), 0), 1);
  const rim =
    context.running && context.state['powered'] === true
      ? mixHex('#3b4049', '#9aa4b2', level)
      : '#3b4049';

  return [
    // Electret capsule: metal can, dark face, two solder legs.
    ...[u(4.4), u(7.4)].map((x) =>
      rect(x - u(0.22), u(11), u(0.44), u(2.2), {
        fill: PART.metal,
        stroke: PART.metalDark,
        strokeWidth: u(0.06),
        detail: 'normal',
      }),
    ),
    circle(u(5.9), u(7), u(3.9), {
      fill: rim,
      stroke: '#22262c',
      strokeWidth: u(0.2),
    }),
    circle(u(5.9), u(7), u(3.1), {
      fill: '#15181d',
      stroke: '#0a0c0f',
      strokeWidth: u(0.12),
    }),
    // The single port hole in the middle of the face.
    circle(u(5.9), u(7), u(0.8), {
      fill: '#33383f',
      detail: 'normal',
    }),
    ...Array.from({ length: 3 }, (_, index) =>
      circle(u(5.9), u(7), u(1.4) + index * u(0.55), {
        fill: 'none',
        stroke: '#262a30',
        strokeWidth: u(0.12),
        opacity: 0.8,
        detail: 'high',
      }),
    ),
    text(u(5.9), u(2.4), 'MIC', {
      size: u(0.75),
      fill: SILK.white,
      anchor: 'middle',
      mono: true,
      weight: 700,
      detail: 'normal',
    }),
    text(u(5.9), u(14), `${Math.round(loudness)} dB`, {
      size: u(0.78),
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
      const loudness = propertyNumber(context, 'loudness', 45);
      const threshold = propertyNumber(context, 'thresholdLoudness', 70);
      context.drive('AO', soundAnalogVoltage(loudness), 'strong');
      context.drive('DO', soundDetected(loudness, threshold) ? 0 : 3.3, 'strong');
    },
    update(context) {
      const loudness = propertyNumber(context, 'loudness', 45);
      const threshold = propertyNumber(context, 'thresholdLoudness', 70);
      context.emit('analogVoltage', soundAnalogVoltage(loudness));
      context.emit('soundDetected', soundDetected(loudness, threshold));
    },
  };
}

export const SOUND_SENSOR: VirtualDevice = createComparatorModule({
  id: 'sound-sensor',
  name: 'Sound sensor',
  model: 'KY-038 + LM393',
  description: 'Detects sound level with an analog envelope and adjustable digital trigger.',
  x: 880,
  y: 150,
  silk: 'KY-038',
  pins: [
    { name: 'VCC', type: 'vcc', description: '3.3-5 V supply' },
    { name: 'GND', type: 'gnd', description: 'Ground reference' },
    {
      name: 'DO',
      type: 'digital',
      description: 'Low while sound passes the threshold',
      output: true,
    },
    { name: 'AO', type: 'analog', description: 'Analog loudness envelope', output: true },
  ],
  head,
  triggered: (context) =>
    soundDetected(
      numberState(context, 'loudness', 45),
      numberState(context, 'thresholdLoudness', 70),
    ),
  properties: PROPERTIES,
  simulation: createBehavior,
  interfaces: ['analog', 'digital', 'power'],
  categoryId: 'sensors',
  category: 'Sensors',
  aliases: ['sound sensor', 'microphone module', 'ky-038', 'เซนเซอร์เสียง', 'ไมโครโฟน'],
  tags: ['sound', 'noise', 'microphone', 'ky-038', 'analog', 'digital', 'sensor'],
  interfaceLabel: 'Analog / digital · 4 pins',
  typicalUsage: 'Clap switches, noise monitoring, and sound-triggered automation.',
});
