import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  booleanState,
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, line, rect, text, type Shape } from '../core/device-shape';
import {
  propertyString,
  type DeviceBehavior,
  type DeviceSimulationContext,
} from '../core/device-simulation';

const WIDTH = 120;
const HEIGHT = 80;
const BODY = 68;
const BODY_X = (WIDTH - BODY) / 2;
const BODY_Y = (HEIGHT - BODY) / 2;
const LEG_TOP = 22;
const LEG_BOTTOM = 58;

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
      line(0, y, BODY_X + 4, y, { stroke: PART.metal, strokeWidth: 4, strokeLinecap: 'round' }),
      line(WIDTH, y, BODY_X + BODY - 4, y, {
        stroke: PART.metal,
        strokeWidth: 4,
        strokeLinecap: 'round',
      }),
    ]),

    rect(BODY_X, BODY_Y, BODY, BODY, {
      rx: 4,
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: 1.5,
    }),
    rect(BODY_X + 6, BODY_Y + 6, BODY - 12, BODY - 12, {
      rx: 3,
      fill: '#1a1d21',
      detail: 'normal',
    }),

    // Actuator. Pressing sinks and darkens the cap — this is the only state
    // cue on the canvas, so it has to read without the label underneath.
    circle(WIDTH / 2, HEIGHT / 2, pressed ? 16 : 19, {
      fill: pressed ? '#8d959f' : PART.metalLight,
      stroke: PART.metalDark,
      strokeWidth: 1.5,
    }),
    circle(WIDTH / 2, HEIGHT / 2, pressed ? 10 : 13, {
      fill: pressed ? '#7d848d' : '#c9ced6',
      detail: 'normal',
    }),

    text(WIDTH / 2, HEIGHT - 2, closed ? 'CLOSED' : 'OPEN', {
      size: 8.5,
      fill: closed ? '#4ade80' : SILK.dim,
      anchor: 'middle',
      weight: 700,
      mono: true,
      detail: 'normal',
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
  model: '12 × 12 mm tactile switch',
  description: 'Momentary contact. Closing it bridges the two sides of the package.',
  x: 220,
  y: 588,
  width: WIDTH,
  height: HEIGHT,
  // 6 x 6 mm tactile switch; the drawn width includes its leads.
  physicalSize: { widthMm: 9, heightMm: 6 },
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
