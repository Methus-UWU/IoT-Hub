import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  booleanState,
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, u } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, line, rect, text, type Shape } from '../core/device-shape';
import {
  propertyString,
  type DeviceBehavior,
  type DeviceSimulationContext,
} from '../core/device-simulation';

/**
 * 6 × 6 mm tactile switch, the four-leg part in every kit.
 *
 * The package is 6 mm square, its legs sit 4.5 mm apart and reach 9.5 mm across
 * the pair, and the actuator cap is 3.5 mm. Drawing those figures is what makes
 * this part visibly smaller than the relay beside it, which is the whole point
 * of the shared scale.
 */

const BODY = bodyFromMm({ widthMm: 9.5, heightMm: 6.5 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

/** Moulded case, centred between the legs. */
const CASE = u(6);
const CASE_X = (WIDTH - CASE) / 2;
const CASE_Y = (HEIGHT - CASE) / 2;
/** Leg rows, 4.5 mm apart on the real part. */
const LEG_TOP = HEIGHT / 2 - u(2.25);
const LEG_BOTTOM = HEIGHT / 2 + u(2.25);

/** Actuator cap. Exported so the canvas hit target matches what is drawn. */
export const BUTTON_CAP = { cx: WIDTH / 2, cy: HEIGHT / 2, r: u(2.1) };

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'pressed',
    label: 'Pressed',
    kind: 'boolean',
    defaultValue: false,
    group: 'simulation',
    simulationOnly: true,
    description: 'Closes the contact between the two sides of the package.',
  },
  {
    id: 'mode',
    label: 'Contact type',
    kind: 'select',
    defaultValue: 'no',
    group: 'general',
    options: [
      { value: 'no', label: 'Normally open (NO)' },
      { value: 'nc', label: 'Normally closed (NC)' },
    ],
  },
];

/** True when the contact conducts, accounting for NO vs NC wiring. */
export function contactClosed(pressed: boolean, mode: string): boolean {
  return mode === 'nc' ? !pressed : pressed;
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const pressed = booleanState(context, 'pressed');
  const closed = contactClosed(pressed, stringState(context, 'mode', 'no'));

  return [
    // Four gull-wing legs.
    ...[LEG_TOP, LEG_BOTTOM].flatMap((y) => [
      line(0, y, CASE_X + u(0.4), y, {
        stroke: PART.metal,
        strokeWidth: u(0.5),
        strokeLinecap: 'round',
      }),
      line(WIDTH, y, CASE_X + CASE - u(0.4), y, {
        stroke: PART.metal,
        strokeWidth: u(0.5),
        strokeLinecap: 'round',
      }),
    ]),

    rect(CASE_X, CASE_Y, CASE, CASE, {
      rx: u(0.4),
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: u(0.15),
    }),
    rect(CASE_X + u(0.6), CASE_Y + u(0.6), CASE - u(1.2), CASE - u(1.2), {
      rx: u(0.3),
      fill: '#1a1d21',
      detail: 'normal',
    }),

    // Actuator. Pressing sinks and darkens the cap — this is the only state
    // cue on the canvas, so it has to read without a label underneath.
    circle(BUTTON_CAP.cx, BUTTON_CAP.cy, pressed ? BUTTON_CAP.r * 0.86 : BUTTON_CAP.r, {
      fill: pressed ? '#8d959f' : PART.metalLight,
      stroke: PART.metalDark,
      strokeWidth: u(0.15),
    }),
    circle(BUTTON_CAP.cx, BUTTON_CAP.cy, pressed ? BUTTON_CAP.r * 0.52 : BUTTON_CAP.r * 0.65, {
      fill: pressed ? '#7d848d' : '#c9ced6',
      detail: 'normal',
    }),

    text(WIDTH / 2, HEIGHT - u(0.2), closed ? 'CLOSED' : 'OPEN', {
      size: u(0.9),
      fill: closed ? '#4ade80' : SILK.dim,
      anchor: 'middle',
      weight: 700,
      mono: true,
      detail: 'high',
    }),
  ];
}

function createBehavior(): DeviceBehavior {
  const isClosed = (context: DeviceSimulationContext) =>
    contactClosed(context.properties['pressed'] === true, propertyString(context, 'mode', 'no'));

  return {
    connect(context) {
      // Legs on the same side are bonded inside the package no matter what.
      context.bond('1', '2');
      context.bond('3', '4');
      // Closing the contact genuinely merges the two nets, so whatever sits on
      // one side — a supply rail, a sensor output — now reaches the other.
      if (isClosed(context)) context.bond('1', '3');
    },
    update(context) {
      context.emit('closed', isClosed(context));
    },
  };
}

/** Four-leg tactile switch. Pins on the same side are internally common. */
export const PUSH_BUTTON: VirtualDevice = {
  id: 'button',
  name: 'Push button',
  model: '6 × 6 mm tactile switch',
  description: 'Momentary contact. Closing it bridges the two sides of the package.',
  x: 220,
  y: 588,
  ...BODY,
  interfaces: ['digital', 'passive'],
  pins: [
    pin('1', 0, LEG_TOP, 'passive', { side: 'left', description: 'Side A, common with pin 2' }),
    pin('2', 0, LEG_BOTTOM, 'passive', { side: 'left', description: 'Side A, common with pin 1' }),
    pin('3', WIDTH, LEG_TOP, 'passive', { side: 'right', description: 'Side B, common with pin 4' }),
    pin('4', WIDTH, LEG_BOTTOM, 'passive', {
      side: 'right',
      description: 'Side B, common with pin 3',
    }),
  ],
  properties: PROPERTIES,
  render: { draw },
  simulation: createBehavior,
  catalog: {
    categoryId: 'input-devices',
    category: 'Input Devices',
    aliases: ['pushbutton', 'tactile switch', 'ปุ่มกด', 'momentary input'],
    tags: ['button', 'switch', 'input', 'momentary', 'digital', 'tactile'],
    interfaceLabel: 'สวิตช์ชั่วขณะ · 4 ขา',
    typicalUsage: 'User controls, reset actions, menu navigation, and triggers.',
  },
};
