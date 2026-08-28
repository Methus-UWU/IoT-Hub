import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  booleanState,
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { PIN_PITCH } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, line, path, repeat, text, type Shape } from '../core/device-shape';
import { isLogicHigh, type DeviceBehavior } from '../core/device-simulation';

const WIDTH = 116;
const HEIGHT = 128;
const CENTER_X = WIDTH / 2;
const CAN_CY = 52;
const CAN_R = 46;
const PIN_START_X = CENTER_X - PIN_PITCH / 2;

type BuzzerKind = 'active' | 'passive';

/**
 * An active buzzer contains its own oscillator, so it only needs a level; a
 * passive one is a bare transducer and needs a driven frequency. That
 * difference is the whole reason both parts exist, so it drives both the
 * property set and the pin descriptions.
 */
function createBuzzer(kind: BuzzerKind): VirtualDevice {
  const active = kind === 'active';

  const properties: readonly DevicePropertyDefinition[] = active
    ? [
        {
          id: 'sounding',
          label: 'Sounding',
          kind: 'boolean',
          defaultValue: false,
          group: 'simulation',
          simulationOnly: true,
          description: 'Driving the input high starts the internal oscillator.',
        },
      ]
    : [
        {
          id: 'sounding',
          label: 'Sounding',
          kind: 'boolean',
          defaultValue: false,
          group: 'simulation',
          simulationOnly: true,
        },
        {
          id: 'frequency',
          label: 'Drive frequency',
          kind: 'number',
          defaultValue: 2000,
          min: 20,
          max: 10_000,
          step: 10,
          unit: 'Hz',
          group: 'simulation',
          description: 'Square wave the controller must generate.',
        },
      ];

  function draw(context: DeviceDrawContext): readonly Shape[] {
    const sounding = booleanState(context, 'sounding') && context.running;
    const frequency = numberState(context, 'frequency', 2000);

    return [
      // Leads. The longer one is positive on an active buzzer.
      line(PIN_START_X, CAN_CY + 40, PIN_START_X, HEIGHT, {
        stroke: PART.metal,
        strokeWidth: 4,
        strokeLinecap: 'round',
      }),
      line(PIN_START_X + PIN_PITCH, CAN_CY + 40, PIN_START_X + PIN_PITCH, HEIGHT - 12, {
        stroke: PART.metal,
        strokeWidth: 4,
        strokeLinecap: 'round',
      }),

      // Black plastic can.
      circle(CENTER_X, CAN_CY, CAN_R, {
        fill: PART.plasticBlack,
        stroke: OUTLINE,
        strokeWidth: 1.5,
      }),
      circle(CENTER_X, CAN_CY, CAN_R - 8, {
        fill: '#1a1d21',
        stroke: '#000',
        strokeWidth: 0.75,
        detail: 'normal',
      }),

      // Sound port.
      circle(CENTER_X, CAN_CY, 9, { fill: '#0a0c0f', stroke: '#3a3f46', strokeWidth: 1 }),

      // Emission arcs, drawn only while it is actually sounding.
      ...(sounding
        ? repeat(3, {}, (index) =>
            path(
              `M ${CENTER_X + 16 + index * 10} ${CAN_CY - 14 - index * 5}
               a ${18 + index * 8} ${18 + index * 8} 0 0 1 0 ${28 + index * 10}`,
              {
                fill: 'none',
                stroke: '#38bdf8',
                strokeWidth: 2.5,
                strokeLinecap: 'round',
                opacity: 0.75 - index * 0.18,
              },
            ),
          )
        : []),

      text(CENTER_X, CAN_CY + 26, active ? 'ACTIVE' : 'PASSIVE', {
        size: 8.5,
        fill: SILK.dim,
        anchor: 'middle',
        weight: 700,
        mono: true,
        detail: 'normal',
      }),

      text(CENTER_X, HEIGHT - 2, sounding && !active ? `${Math.round(frequency)} Hz` : '', {
        size: 9.5,
        fill: '#38bdf8',
        anchor: 'middle',
        weight: 600,
        mono: true,
        detail: 'normal',
      }),

      text(PIN_START_X - 8, CAN_CY + 52, '+', {
        size: 12,
        fill: SILK.dim,
        anchor: 'middle',
        weight: 700,
        detail: 'high',
      }),
    ];
  }

  return {
    id: `buzzer-${kind}`,
    name: `${active ? 'Active' : 'Passive'} buzzer`,
    model: active ? 'Magnetic, self-driving' : 'Piezo transducer',
    description: active
      ? 'Sounds a fixed tone whenever its input is driven high.'
      : 'Bare transducer — the controller must generate the tone frequency.',
    x: 340,
    y: 760,
    width: WIDTH,
    height: HEIGHT,
    initiallyVisible: false,
    operatingVoltage: { min: 3, max: 5.5, recommended: 5 },
    interfaces: active ? ['digital'] : ['pwm', 'digital'],
    pins: [
      pin('+', PIN_START_X, HEIGHT, active ? 'digital' : 'pwm', {
        side: 'bottom',
        direction: 'input',
        description: active ? 'Drive high to sound' : 'Drive with a square wave at the tone frequency',
      }),
      pin('−', PIN_START_X + PIN_PITCH, HEIGHT - 12, 'gnd', {
        side: 'bottom',
        description: 'Ground reference',
      }),
    ],
    properties,
    render: { draw },
    catalog: {
      categoryId: 'audio',
      category: 'Audio',
      aliases: ['buzzer', 'piezo', 'ลำโพง', 'beeper', `${kind} buzzer`],
      tags: ['buzzer', 'audio', 'sound', 'piezo', 'alarm', 'output', kind],
      interfaceLabel: active ? 'ดิจิทัล · 2 ขา' : 'PWM · 2 ขา',
      typicalUsage: active
        ? 'Alarms, button feedback, and completion beeps.'
        : 'Melodies, variable-pitch alerts, and tone generation.',
    },
  };
}

export const BUZZER_ACTIVE = createBuzzer('active');
export const BUZZER_PASSIVE = createBuzzer('passive');

/**
 * Sounds whenever the drive leg sits a logic level above the ground leg. A
 * passive buzzer additionally needs a frequency, but the workspace cannot see
 * a PWM waveform, so the configured frequency stands in for it.
 */
function createBuzzerBehavior(): DeviceBehavior {
  return {
    update(context) {
      const drive = context.readNode('+');
      const ground = context.readNode('−');
      const powered =
        !drive.floating && !ground.floating && isLogicHigh({
          voltage: drive.voltage - ground.voltage,
          floating: false,
          conflict: false,
        });
      context.emit('sounding', powered);
    },
  };
}

BUZZER_ACTIVE.simulation = createBuzzerBehavior;
BUZZER_PASSIVE.simulation = createBuzzerBehavior;
