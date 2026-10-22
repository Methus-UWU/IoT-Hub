import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  booleanState,
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { circleHotspot } from '../core/device-hotspots';
import { bodyFromMm, u } from '../core/device-metrics';
import { FLAT } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, rect, type Shape } from '../core/device-shape';
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

/**
 * Actuator cap. Exported so the canvas hit target matches what is drawn.
 *
 * 3.5 mm across on the real part, so 1.75 mm of radius. It was drawn at 2.1 mm
 * and swallowed most of the 6 mm case, which is what made the part read as a
 * cartoon button rather than a tact switch.
 */
export const BUTTON_CAP = { cx: WIDTH / 2, cy: HEIGHT / 2, r: u(1.75) };

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
    id: 'capColor',
    label: 'Cap colour',
    kind: 'select',
    defaultValue: 'silver',
    group: 'general',
    description: 'Colour of the moulded actuator cap fitted over the dome.',
    options: [
      { value: 'silver', label: 'Bare steel dome' },
      { value: 'red', label: 'Red cap' },
      { value: 'yellow', label: 'Yellow cap' },
      { value: 'blue', label: 'Blue cap' },
      { value: 'green', label: 'Green cap' },
    ],
  },
  {
    id: 'mode',
    label: 'Contact type',
    kind: 'select',
    defaultValue: 'no',
    group: 'general',
    description: 'NO closes the contact while pressed; NC opens it while pressed.',
    options: [
      { value: 'no', label: 'NO' },
      { value: 'nc', label: 'NC' },
    ],
  },
];

const CAP_COLORS: Readonly<Record<string, { base: string; dark: string }>> = {
  silver: { base: FLAT.metalLight, dark: FLAT.metalDark },
  red: { base: FLAT.red, dark: FLAT.plastic },
  yellow: { base: FLAT.gold, dark: FLAT.goldDark },
  blue: { base: FLAT.blue, dark: FLAT.boardEdge },
  green: { base: '#2f9e57', dark: '#1a6234' },
};

/** True when the contact conducts, accounting for NO vs NC wiring. */
export function contactClosed(pressed: boolean, mode: string): boolean {
  return mode === 'nc' ? !pressed : pressed;
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const pressed = booleanState(context, 'pressed');
  const cap = CAP_COLORS[stringState(context, 'capColor', 'silver')] ?? CAP_COLORS['silver'];
  const legWidth = u(0.9);

  return [
    // Four legs. Each is a stub of tinned strip emerging from under the case,
    // widening into the solder tab at the tip — the shape that makes the part
    // read as four terminals rather than two wires passing through a block.
    ...[LEG_TOP, LEG_BOTTOM].flatMap((y) => [
      rect(0, y - legWidth / 2, CASE_X + u(0.6), legWidth, {
        rx: legWidth / 2,
        fill: FLAT.metal,
        stroke: FLAT.metalDark,
        strokeWidth: u(0.06),
      }),
      rect(CASE_X + CASE - u(0.6), y - legWidth / 2, WIDTH - CASE_X - CASE + u(0.6), legWidth, {
        rx: legWidth / 2,
        fill: FLAT.metal,
        stroke: FLAT.metalDark,
        strokeWidth: u(0.06),
      }),
    ]),

    // Moulded case. Black nylon, not grey: the contrast against the steel plate
    // is what makes the part legible at thumbnail size.
    rect(CASE_X, CASE_Y, CASE, CASE, {
      rx: u(0.4),
      fill: FLAT.plastic,
      stroke: FLAT.plastic,
      strokeWidth: u(0.18),
    }),
    // The stainless top plate crimped over the dome, inset from the case edge.
    rect(CASE_X + u(0.55), CASE_Y + u(0.55), CASE - u(1.1), CASE - u(1.1), {
      rx: u(0.25),
      fill: FLAT.metalLight,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.1),
      detail: 'normal',
    }),
    circle(BUTTON_CAP.cx, BUTTON_CAP.cy, pressed ? BUTTON_CAP.r * 0.88 : BUTTON_CAP.r, {
      fill: pressed ? cap.dark : cap.base,
      stroke: cap.dark,
      strokeWidth: u(0.12),
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
    pin('3', WIDTH, LEG_TOP, 'passive', {
      side: 'right',
      description: 'Side B, common with pin 4',
    }),
    pin('4', WIDTH, LEG_BOTTOM, 'passive', {
      side: 'right',
      description: 'Side B, common with pin 3',
    }),
  ],
  properties: PROPERTIES,
  // The cap is pressable straight on the canvas. Momentary, so it releases with
  // the pointer exactly as the real part does.
  hotspots: [
    circleHotspot(
      'cap',
      'Press the push button',
      'pressed',
      BUTTON_CAP.cx,
      BUTTON_CAP.cy,
      // A 3.5 mm cap is a small target at working zoom, so the hit area is
      // grown to the case. Nothing else on this part is clickable, so there is
      // nothing for it to steal a click from.
      CASE / 2,
    ),
  ],
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
