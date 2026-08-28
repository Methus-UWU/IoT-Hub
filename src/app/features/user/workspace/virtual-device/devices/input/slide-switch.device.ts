import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { PIN_PITCH } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { line, rect, text, type Shape } from '../core/device-shape';
import { propertyString, type DeviceBehavior } from '../core/device-simulation';

const WIDTH = 120;
const HEIGHT = 74;
const PIN_Y = HEIGHT + 22;
const PIN_START_X = WIDTH / 2 - PIN_PITCH;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'position',
    label: 'Position',
    kind: 'select',
    defaultValue: 'a',
    group: 'general',
    description: 'Which end terminal the common pin is bonded to.',
    options: [
      { value: 'a', label: 'A — COM to pin 1' },
      { value: 'b', label: 'B — COM to pin 3' },
    ],
  },
];

function draw(context: DeviceDrawContext): readonly Shape[] {
  const position = stringState(context, 'position', 'a');
  const atA = position === 'a';
  const actuatorX = atA ? 28 : WIDTH - 28 - 26;

  return [
    // Terminals.
    ...[0, 1, 2].map((index) =>
      line(PIN_START_X + index * PIN_PITCH, HEIGHT - 6, PIN_START_X + index * PIN_PITCH, PIN_Y, {
        stroke: PART.metal,
        strokeWidth: 4,
        strokeLinecap: 'round',
      }),
    ),

    // Metal can with the moulded slot the actuator travels in.
    rect(0, 8, WIDTH, HEIGHT - 8, {
      rx: 4,
      fill: PART.metal,
      stroke: PART.metalDark,
      strokeWidth: 1.5,
    }),
    rect(18, 20, WIDTH - 36, 26, {
      rx: 3,
      fill: '#7d848d',
      stroke: OUTLINE,
      strokeWidth: 1,
    }),

    // Actuator — its side of the slot is the whole state readout.
    rect(actuatorX, 4, 26, 40, {
      rx: 3,
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: 1.25,
    }),
    ...[0, 1, 2].map((index) =>
      line(actuatorX + 6, 12 + index * 8, actuatorX + 20, 12 + index * 8, {
        stroke: '#4b5058',
        strokeWidth: 1.5,
        detail: 'high',
      }),
    ),

    text(WIDTH / 2, HEIGHT - 10, atA ? 'A ◂' : '▸ B', {
      size: 11,
      fill: SILK.dim,
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
  width: WIDTH,
  height: HEIGHT,
  initiallyVisible: false,
  interfaces: ['digital', 'passive'],
  pins: [
    pin('1', PIN_START_X, PIN_Y, 'passive', {
      side: 'bottom',
      description: 'Throw A — connected when the actuator is left',
    }),
    pin('COM', PIN_START_X + PIN_PITCH, PIN_Y, 'passive', {
      side: 'bottom',
      description: 'Common pole',
    }),
    pin('3', PIN_START_X + PIN_PITCH * 2, PIN_Y, 'passive', {
      side: 'bottom',
      description: 'Throw B — connected when the actuator is right',
    }),
  ],
  properties: PROPERTIES,
  render: { draw, bleed: { bottom: 24 } },
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
