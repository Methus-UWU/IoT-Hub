import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  booleanState,
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, u } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, line, path, repeat, text, type Shape } from '../core/device-shape';
import {
  isLogicHigh,
  propertyNumber,
  supplyVolts,
  type DeviceBehavior,
} from '../core/device-simulation';

/**
 * A 12 mm buzzer can on 7.62 mm lead spacing — three header pitches, which is
 * what lets one straddle the ravine of a breadboard.
 */
const BODY = bodyFromMm({ widthMm: 13, heightMm: 16 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
const CENTER_X = WIDTH / 2;
const CAN_CY = u(6.5);
const CAN_R = u(6);
const LEAD_PITCH = u(7.62);
const PIN_START_X = CENTER_X - LEAD_PITCH / 2;
const LEAD_ATTACH_Y = CAN_CY + Math.sqrt(CAN_R ** 2 - (LEAD_PITCH / 2) ** 2) - u(0.45);
/** The negative lead is cut short, as it is on the real part. */
const SHORT_LEAD_Y = HEIGHT - u(1.2);

type BuzzerKind = 'active' | 'passive';

/** Where the resonator inside a 12 mm active can actually sits. */
const ACTIVE_BUZZER_HZ = 2400;

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
    // The pitch actually sounding: a sketch's tone(), else the configured frequency.
    const frequency = numberState(context, 'toneHz', numberState(context, 'frequency', 2000));

    return [
      // Short leads start beneath the can so they remain visually attached.
      line(PIN_START_X, LEAD_ATTACH_Y, PIN_START_X, HEIGHT, {
        stroke: PART.metal,
        strokeWidth: u(0.45),
        strokeLinecap: 'round',
      }),
      line(PIN_START_X + LEAD_PITCH, LEAD_ATTACH_Y, PIN_START_X + LEAD_PITCH, SHORT_LEAD_Y, {
        stroke: PART.metal,
        strokeWidth: u(0.45),
        strokeLinecap: 'round',
      }),

      // Black plastic can.
      circle(CENTER_X, CAN_CY, CAN_R, {
        fill: PART.plasticBlack,
        stroke: OUTLINE,
        strokeWidth: u(0.15),
      }),
      circle(CENTER_X, CAN_CY, CAN_R - u(0.8), {
        fill: '#1a1d21',
        stroke: '#000',
        strokeWidth: u(0.08),
        detail: 'normal',
      }),

      // Sound port.
      circle(CENTER_X, CAN_CY, u(1), {
        fill: '#0a0c0f',
        stroke: '#3a3f46',
        strokeWidth: u(0.1),
      }),

      // Emission arcs, drawn only while it is actually sounding.
      ...(sounding
        ? repeat(3, {}, (index) =>
            path(
              `M ${CENTER_X + u(1.8) + index * u(1)} ${CAN_CY - u(1.6) - index * u(0.5)}` +
                ` a ${u(2) + index * u(0.8)} ${u(2) + index * u(0.8)} 0 0 1 0 ${
                  u(3.2) + index * u(1)
                }`,
              {
                fill: 'none',
                stroke: '#38bdf8',
                strokeWidth: u(0.28),
                strokeLinecap: 'round',
                opacity: 0.75 - index * 0.18,
              },
            ),
          )
        : []),

      text(CENTER_X, CAN_CY + u(3), active ? 'ACTIVE' : 'PASSIVE', {
        size: u(1),
        fill: SILK.dim,
        anchor: 'middle',
        weight: 700,
        mono: true,
        detail: 'normal',
      }),

      text(CENTER_X, HEIGHT - u(0.3), sounding && !active ? `${Math.round(frequency)} Hz` : '', {
        size: u(1),
        fill: '#38bdf8',
        anchor: 'middle',
        weight: 600,
        mono: true,
        detail: 'normal',
      }),

      text(PIN_START_X - u(1.1), CAN_CY + u(6.4), '+', {
        size: u(1.3),
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
    ...BODY,
    initiallyVisible: false,
    operatingVoltage: { min: 3, max: 5.5, recommended: 5 },
    interfaces: active ? ['digital'] : ['pwm', 'digital'],
    pins: [
      pin('+', PIN_START_X, HEIGHT, active ? 'digital' : 'pwm', {
        side: 'bottom',
        direction: 'input',
        description: active
          ? 'Drive high to sound'
          : 'Drive with a square wave at the tone frequency',
      }),
      pin('−', PIN_START_X + LEAD_PITCH, SHORT_LEAD_Y, 'gnd', {
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
      // A sketch's tone() puts its pitch on the drive leg. The buzzer sounds it
      // whenever its other leg returns to ground, whatever the square wave averages to.
      const tone = (context.readNode('+').messages ?? []).find(
        (message) => message.protocol === 'tone',
      );
      const hz = tone?.data['hz'];
      if (typeof hz === 'number' && hz > 0) {
        const ground = context.readNode('−');
        const grounded = !ground.floating && ground.voltage < 0.5;
        context.emit('sounding', grounded);
        context.emit('toneHz', Math.round(hz));
        return;
      }

      // supplyVolts is 0 when a leg floats or the legs reach different supplies.
      const powered = isLogicHigh({
        voltage: supplyVolts(context, '+', '−'),
        floating: false,
        conflict: false,
      });
      context.emit('sounding', powered);
      // The pitch the canvas should play it at. A passive buzzer is a bare
      // transducer, so its tone is whatever the sketch drives it with — which
      // the workspace cannot see, so the configured frequency stands in. An
      // active one has no such property and falls back to the tone its own
      // internal oscillator runs at.
      context.emit('toneHz', Math.round(propertyNumber(context, 'frequency', ACTIVE_BUZZER_HZ)));
    },
  };
}

BUZZER_ACTIVE.simulation = createBuzzerBehavior;
BUZZER_PASSIVE.simulation = createBuzzerBehavior;
