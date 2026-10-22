import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { line, rect, text, type Shape } from '../core/device-shape';
import { propertyString, type DeviceBehavior } from '../core/device-simulation';

/**
 * SS12D00: an 8.9 × 3.6 mm can with three lugs on 0.1 in pitch below it. The
 * body is barely wider than its own pin span, which is what makes this part read
 * as the tiny thing it is next to a relay or a servo.
 */
const BODY = bodyFromMm({ widthMm: 9, heightMm: 8 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;
/** Metal can, sitting on top with the lugs reaching down from it. */
const CAN_TOP = u(0.5);
const CAN_HEIGHT = u(3.6);
const CAN_BOTTOM = CAN_TOP + CAN_HEIGHT;
/** Actuator travel: 3 mm of slot, 2 mm of slider. */
const SLIDER_WIDTH = u(2);
const PIN_Y = HEIGHT;
const PIN_START_X = WIDTH / 2 - HEADER_PITCH;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'position',
    label: 'Position',
    kind: 'select',
    defaultValue: 'a',
    group: 'general',
    description: 'Which end terminal the common pin is bonded to.',
    options: [
      { value: 'a', label: 'A (pin 1)' },
      { value: 'b', label: 'B (pin 3)' },
    ],
  },
];

function draw(context: DeviceDrawContext): readonly Shape[] {
  const position = stringState(context, 'position', 'a');
  const atA = position === 'a';
  const actuatorX = atA ? u(2.6) : WIDTH - u(2.6) - SLIDER_WIDTH;

  return [
    // Terminals.
    ...[0, 1, 2].map((index) =>
      line(
        PIN_START_X + index * HEADER_PITCH,
        CAN_BOTTOM - u(0.2),
        PIN_START_X + index * HEADER_PITCH,
        PIN_Y,
        { stroke: PART.metal, strokeWidth: u(0.45), strokeLinecap: 'round' },
      ),
    ),

    // Metal can with the moulded slot the actuator travels in.
    rect(0, CAN_TOP, WIDTH, CAN_HEIGHT, {
      rx: u(0.35),
      fill: PART.metal,
      stroke: PART.metalDark,
      strokeWidth: u(0.15),
    }),
    rect(u(2.4), CAN_TOP + u(0.9), WIDTH - u(4.8), CAN_HEIGHT - u(1.8), {
      rx: u(0.25),
      fill: '#7d848d',
      stroke: OUTLINE,
      strokeWidth: u(0.1),
    }),

    // Actuator — its side of the slot is the whole state readout.
    rect(actuatorX, CAN_TOP - u(0.5), SLIDER_WIDTH, CAN_HEIGHT + u(1), {
      rx: u(0.25),
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: u(0.12),
    }),
    ...[0, 1, 2].map((index) =>
      line(
        actuatorX + u(0.4),
        CAN_TOP + u(0.6) + index * u(0.9),
        actuatorX + SLIDER_WIDTH - u(0.4),
        CAN_TOP + u(0.6) + index * u(0.9),
        { stroke: '#4b5058', strokeWidth: u(0.12), detail: 'high' },
      ),
    ),

    // Throw markings on the can, the way a real switch is printed.
    text(u(1.1), CAN_BOTTOM - u(1.2), 'A', {
      size: u(1.2),
      fill: atA ? '#2563eb' : SILK.dim,
      anchor: 'middle',
      weight: 700,
      mono: true,
      detail: 'normal',
    }),
    text(WIDTH - u(1.1), CAN_BOTTOM - u(1.2), 'B', {
      size: u(1.2),
      fill: atA ? SILK.dim : '#2563eb',
      anchor: 'middle',
      weight: 700,
      mono: true,
      detail: 'normal',
    }),
  ];
}

/**
 * SPDT slide switch. The common terminal bonds to one end pin or the other —
 * never both — so the artwork and the pin metadata both encode a hard changeover.
 */
export const SLIDE_SWITCH: VirtualDevice = {
  id: 'slide-switch',
  name: 'Slide switch',
  model: 'SS12D00 SPDT',
  description: 'Single-pole double-throw slide switch. COM bonds to one side at a time.',
  x: 520,
  y: 760,
  ...BODY,
  initiallyVisible: false,
  interfaces: ['digital', 'passive'],
  pins: [
    pin('1', PIN_START_X, PIN_Y, 'passive', {
      side: 'bottom',
      description: 'Throw A — connected when the actuator is left',
    }),
    pin('COM', PIN_START_X + HEADER_PITCH, PIN_Y, 'passive', {
      side: 'bottom',
      description: 'Common pole',
    }),
    pin('3', PIN_START_X + HEADER_PITCH * 2, PIN_Y, 'passive', {
      side: 'bottom',
      description: 'Throw B — connected when the actuator is right',
    }),
  ],
  properties: PROPERTIES,
  render: { draw },
  catalog: {
    categoryId: 'switches',
    category: 'Switches',
    aliases: ['slide switch', 'spdt', 'สวิตช์เลื่อน', 'changeover switch'],
    tags: ['switch', 'slide', 'spdt', 'input', 'toggle', 'selector'],
    interfaceLabel: 'SPDT · 3 ขา',
    typicalUsage: 'Power on/off, mode selection, and battery source changeover.',
  },
};

/**
 * SPDT contact: COM bonds to exactly one throw, never both. Modelling it as a
 * bond rather than a copied voltage means the unselected throw is genuinely
 * isolated, so a circuit switched away from a rail really does go dead.
 */
function createSlideBehavior(): DeviceBehavior {
  return {
    connect(context) {
      const atA = propertyString(context, 'position', 'a') === 'a';
      context.bond('COM', atA ? '1' : '3');
    },
    update(context) {
      context.emit('position', propertyString(context, 'position', 'a'));
    },
  };
}

SLIDE_SWITCH.simulation = createSlideBehavior;
