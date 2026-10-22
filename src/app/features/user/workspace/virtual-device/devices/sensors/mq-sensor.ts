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
 * The MQ gas sensor family on the LM393 breakout.
 *
 * Every MQ part is the same heated tin-dioxide bead behind a double steel mesh,
 * which is why it draws as a cylinder rather than a chip. What changes between an
 * MQ-2, an MQ-7 and an MQ-135 is how the bead is doped — which gases lower its
 * resistance, and over what concentration window. A part in this family is
 * therefore its detection window, its default alarm point and its words; the can,
 * the response curve and the board are shared.
 *
 * Resistance falls as concentration rises, so the analog output climbs with ppm
 * on a log scale. A linear map would make the bottom and the top of the window
 * look alike.
 */

export interface MqSensorConfig {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly description: string;
  readonly x: number;
  readonly y: number;
  /** Silkscreen part code along the board edge. */
  readonly silk: string;
  /** Datasheet detection window, in ppm. The analog curve spans exactly this. */
  readonly minPpm: number;
  readonly maxPpm: number;
  /** Inspector step for both concentration fields. */
  readonly step: number;
  readonly defaultPpm: number;
  readonly defaultThresholdPpm: number;
  /** What the concentration field measures, shown in the inspector. */
  readonly concentrationDescription: string;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly typicalUsage: string;
}

/** Log map across a sensor's detection window. */
export function mqAnalogVoltage(ppm: number, minPpm: number, maxPpm: number, rail = 3.3): number {
  const clamped = Math.min(Math.max(ppm, minPpm), maxPpm);
  const span = Math.log10(maxPpm) - Math.log10(minPpm);
  return (rail * (Math.log10(clamped) - Math.log10(minPpm))) / span;
}

export function mqAlarming(ppm: number, thresholdPpm: number): boolean {
  return ppm >= thresholdPpm;
}

export function createMqSensor(config: MqSensorConfig): VirtualDevice {
  const { minPpm, maxPpm, defaultPpm, defaultThresholdPpm } = config;

  const properties: readonly DevicePropertyDefinition[] = [
    {
      id: 'ppm',
      label: 'Gas concentration',
      kind: 'number',
      defaultValue: defaultPpm,
      min: minPpm,
      max: maxPpm,
      step: config.step,
      unit: 'ppm',
      group: 'simulation',
      description: config.concentrationDescription,
    },
    {
      id: 'thresholdPpm',
      label: 'Alarm threshold',
      kind: 'number',
      defaultValue: defaultThresholdPpm,
      min: minPpm,
      max: maxPpm,
      step: config.step,
      unit: 'ppm',
      group: 'simulation',
      description: 'Trimmer setting above which DO switches low.',
    },
    {
      id: 'warmUpSeconds',
      label: 'Warm-up time',
      kind: 'number',
      defaultValue: 20,
      min: 0,
      max: 300,
      step: 1,
      unit: 's',
      group: 'electrical',
      description: 'Heater preheat before readings settle. Real MQ sensors need minutes.',
    },
  ];

  const voltage = (ppm: number) => mqAnalogVoltage(ppm, minPpm, maxPpm);

  function head(context: DeviceDrawContext): readonly Shape[] {
    const ppm = numberState(context, 'ppm', defaultPpm);
    const threshold = numberState(context, 'thresholdPpm', defaultThresholdPpm);
    const load = Math.min(Math.max((ppm - minPpm) / (maxPpm - minPpm), 0), 1);
    // The heater glows through the mesh once the part is running; more gas means
    // a hotter-looking bead, which is the only visual cue the real can gives.
    const glow =
      context.running && context.state['powered'] === true
        ? mixHex('#8b8f96', '#e07a3c', load)
        : '#8b8f96';

    return [
      // Every MQ can looks the same, so the model code is printed above it at
      // working zoom — it is the only thing that tells an MQ-2 from an MQ-135.
      text(u(5.9), u(2.4), config.silk, {
        size: u(0.9),
        fill: SILK.white,
        anchor: 'middle',
        mono: true,
        weight: 700,
        detail: 'normal',
      }),
      circle(u(5.9), u(7.5), u(4.4), {
        fill: '#5c6169',
        stroke: '#33373d',
        strokeWidth: u(0.2),
      }),
      circle(u(5.9), u(7.5), u(3.6), {
        fill: glow,
        stroke: '#3f444b',
        strokeWidth: u(0.14),
      }),
      // Steel mesh: a coarse cross-hatch reads as woven metal at canvas scale.
      ...Array.from({ length: 6 }, (_, index) =>
        line(u(2.5), u(4.6) + index * u(1.15), u(9.3), u(4.6) + index * u(1.15), {
          stroke: '#454a51',
          strokeWidth: u(0.16),
          opacity: 0.75,
          detail: 'normal',
        }),
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        line(u(2.9) + index * u(1.15), u(3.9), u(2.9) + index * u(1.15), u(11.1), {
          stroke: '#454a51',
          strokeWidth: u(0.16),
          opacity: 0.75,
          detail: 'normal',
        }),
      ),
      circle(u(5.9), u(7.5), u(4.4), {
        fill: 'none',
        stroke: PART.metalDark,
        strokeWidth: u(0.28),
      }),
      rect(u(1.4), u(12.2), u(9), u(1.5), {
        rx: u(0.2),
        fill: '#14325e',
        stroke: OUTLINE,
        strokeWidth: u(0.08),
        detail: 'high',
      }),
      text(u(5.9), u(13.35), mqAlarming(ppm, threshold) ? 'ALARM' : `${Math.round(ppm)} ppm`, {
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
        const ppm = propertyNumber(context, 'ppm', defaultPpm);
        const threshold = propertyNumber(context, 'thresholdPpm', defaultThresholdPpm);
        context.drive('AO', voltage(ppm), 'strong');
        context.drive('DO', mqAlarming(ppm, threshold) ? 0 : 3.3, 'strong');
      },
      update(context) {
        const ppm = propertyNumber(context, 'ppm', defaultPpm);
        const threshold = propertyNumber(context, 'thresholdPpm', defaultThresholdPpm);
        context.emit('analogVoltage', voltage(ppm));
        context.emit('alarm', mqAlarming(ppm, threshold));
      },
    };
  }

  return createComparatorModule({
    id: config.id,
    name: config.name,
    model: config.model,
    description: config.description,
    x: config.x,
    y: config.y,
    silk: config.silk,
    pins: [
      { name: 'VCC', type: 'vcc', description: '5 V supply for the heater' },
      { name: 'GND', type: 'gnd', description: 'Ground reference' },
      {
        name: 'DO',
        type: 'digital',
        description: 'Low once concentration passes the threshold',
        output: true,
      },
      { name: 'AO', type: 'analog', description: 'Analog concentration level', output: true },
    ],
    head,
    triggered: (context) =>
      mqAlarming(
        numberState(context, 'ppm', defaultPpm),
        numberState(context, 'thresholdPpm', defaultThresholdPpm),
      ),
    properties,
    simulation: createBehavior,
    interfaces: ['analog', 'digital', 'power'],
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: config.aliases,
    tags: config.tags,
    interfaceLabel: 'Analog / digital · 4 pins',
    typicalUsage: config.typicalUsage,
  });
}
