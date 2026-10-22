import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  booleanState,
  numberState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { rectHotspot } from '../core/device-hotspots';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { FLAT, SILK } from '../core/device-palette';
import { flatBoard, flatHeader, flatMountingHole, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, rect, text, type Shape } from '../core/device-shape';
import { propertyBoolean, propertyNumber, type DeviceBehavior } from '../core/device-simulation';

/**
 * KY-023 analog joystick.
 *
 * Two 10 kΩ potentiometers under a gimbal and a push switch under the cap. Each
 * axis is a divider between the supply and ground, so at rest both outputs sit
 * at mid-rail and moving the stick swings them toward either rail. Pressing the
 * stick shorts SW to GND; there is no pull-up on the board.
 */

const BODY = bodyFromMm({ widthMm: 40, heightMm: 26 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

const STICK_X = u(14);
const STICK_Y = u(13);
const CAP_R = u(6.5);
/** How far the cap is drawn off-centre at full deflection. */
const TRAVEL = u(2);

const HEADER_X = WIDTH - u(2.5);
const LEAD_END = WIDTH + u(4);

const PINS = [
  ['GND', 'gnd', 'Ground reference'],
  ['+5V', 'vcc', 'Supply. On an ESP32 use 3.3 V so VRx and VRy stay inside the ADC range'],
  ['VRx', 'analog', 'X axis: mid-rail at rest, toward a rail as the stick moves'],
  ['VRy', 'analog', 'Y axis: mid-rail at rest, toward a rail as the stick moves'],
  ['SW', 'digital', 'Push switch to GND. Needs INPUT_PULLUP'],
] as const;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'xAxis',
    label: 'X axis',
    kind: 'number',
    defaultValue: 0,
    min: -100,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    description: 'Stick position, left (−) to right (+).',
  },
  {
    id: 'yAxis',
    label: 'Y axis',
    kind: 'number',
    defaultValue: 0,
    min: -100,
    max: 100,
    step: 1,
    unit: '%',
    group: 'simulation',
    description: 'Stick position, up (−) to down (+).',
  },
  {
    id: 'pressed',
    label: 'Pressed',
    kind: 'boolean',
    defaultValue: false,
    group: 'simulation',
    description: 'Pushes the stick down, closing SW to GND.',
  },
];

/** Where along the divider an axis sits: 0 at one rail, 0.5 at rest, 1 at the other. */
export function joystickAxisRatio(percent: number): number {
  return (Math.min(Math.max(percent, -100), 100) + 100) / 200;
}

function pinY(index: number): number {
  return STICK_Y + (index - 2) * HEADER_PITCH;
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const x = Math.min(Math.max(numberState(context, 'xAxis', 0), -100), 100);
  const y = Math.min(Math.max(numberState(context, 'yAxis', 0), -100), 100);
  const pressed = booleanState(context, 'pressed', false);
  const capX = STICK_X + (TRAVEL * x) / 100;
  const capY = STICK_Y + (TRAVEL * y) / 100;

  return [
    ...flatBoard(WIDTH, HEIGHT),
    flatMountingHole(u(2.4), u(2.4), u(1.2)),
    flatMountingHole(u(2.4), HEIGHT - u(2.4), u(1.2)),
    flatMountingHole(u(31), u(2.4), u(1.2)),
    flatMountingHole(u(31), HEIGHT - u(2.4), u(1.2)),

    // The two axis potentiometers, on the right and bottom of the gimbal.
    rect(u(23.6), u(9), u(2.6), u(8), {
      rx: u(0.3),
      fill: FLAT.blue,
      stroke: FLAT.boardEdge,
      strokeWidth: u(0.12),
    }),
    rect(u(10), u(22.6), u(8), u(2.6), {
      rx: u(0.3),
      fill: FLAT.blue,
      stroke: FLAT.boardEdge,
      strokeWidth: u(0.12),
    }),

    // Gimbal housing, then the thumb cap riding on it.
    rect(STICK_X - u(8), STICK_Y - u(8), u(16), u(16), {
      rx: u(0.8),
      fill: FLAT.plastic,
      stroke: '#0b0d10',
      strokeWidth: u(0.15),
    }),
    circle(capX, capY, CAP_R, {
      fill: '#1a1d22',
      stroke: '#0b0d10',
      strokeWidth: u(0.2),
    }),
    circle(capX, capY, u(4.5), {
      fill: 'none',
      stroke: '#3a414b',
      strokeWidth: u(0.5),
      detail: 'normal',
    }),
    ...(pressed ? [circle(capX, capY, u(1.4), { fill: FLAT.blue })] : []),

    silkLabel(u(24.5), u(24.6), 'KY-023', { size: u(0.9), detail: 'normal' }),

    ...flatHeader(HEADER_X, pinY(0), PINS.length, 'vertical'),
    ...PINS.flatMap(([name], index) => [
      rect(HEADER_X, pinY(index) - u(0.28), LEAD_END - HEADER_X, u(0.56), {
        rx: u(0.18),
        fill: FLAT.metal,
        stroke: FLAT.metalDark,
        strokeWidth: u(0.06),
      }),
      text(HEADER_X - u(1.6), pinY(index) + u(0.3), name, {
        size: u(0.8),
        fill: SILK.white,
        anchor: 'end',
        mono: true,
        weight: 700,
        detail: 'normal',
      }),
    ]),
  ];
}

function createBehavior(): DeviceBehavior {
  return {
    connect(context) {
      if (propertyBoolean(context, 'pressed', false)) context.bond('SW', 'GND');
    },
    // Each axis is a divider, not a source: it interpolates between whatever the
    // supply and ground pins resolved to, and drives weakly so a real driver wins.
    drive(context) {
      const supply = context.readNode('+5V');
      if (supply.floating) return;
      const ground = context.readNode('GND');
      const low = ground.floating ? 0 : ground.voltage;
      const span = supply.voltage - low;
      context.drive(
        'VRx',
        low + span * joystickAxisRatio(propertyNumber(context, 'xAxis', 0)),
        'weak',
      );
      context.drive(
        'VRy',
        low + span * joystickAxisRatio(propertyNumber(context, 'yAxis', 0)),
        'weak',
      );
    },
    update(context) {
      const volts = (name: string) => {
        const node = context.readNode(name);
        return node.floating ? 0 : Math.round(node.voltage * 100) / 100;
      };
      context.emit('xVolts', volts('VRx'));
      context.emit('yVolts', volts('VRy'));
    },
  };
}

export const JOYSTICK: VirtualDevice = {
  id: 'joystick',
  name: 'Analog joystick',
  model: 'KY-023 dual-axis joystick',
  description: 'Thumbstick with two analog axes and a push switch.',
  x: 540,
  y: 700,
  ...BODY,
  initiallyVisible: false,
  rotatable: true,
  printsOwnPinLabels: true,
  operatingVoltage: { min: 3.3, max: 5, recommended: 3.3 },
  interfaces: ['analog', 'digital', 'power'],
  pins: PINS.map(([name, type, description], index) =>
    pin(name, LEAD_END, pinY(index), type, {
      side: 'right',
      direction: name === 'VRx' || name === 'VRy' ? 'output' : undefined,
      description,
      voltage: name === '+5V' ? 3.3 : undefined,
    }),
  ),
  properties: PROPERTIES,
  readings: [
    { id: 'xVolts', label: 'VRx voltage', unit: 'V' },
    { id: 'yVolts', label: 'VRy voltage', unit: 'V' },
  ],
  hotspots: [
    rectHotspot('press', 'Press the joystick', 'pressed', {
      x: STICK_X - CAP_R,
      y: STICK_Y - CAP_R,
      width: CAP_R * 2,
      height: CAP_R * 2,
      rx: CAP_R,
    }),
  ],
  simulation: createBehavior,
  render: { draw, bleed: { right: u(4.5) } },
  catalog: {
    categoryId: 'input-devices',
    category: 'Input Devices',
    aliases: ['joystick', 'ky-023', 'thumbstick', 'analog joystick', 'จอยสติ๊ก'],
    tags: ['joystick', 'analog', 'input', 'axis', 'button', 'robot', 'game', 'controller'],
    interfaceLabel: 'แอนะล็อก / ดิจิทัล · 5 ขา',
    typicalUsage: 'Robot and pan-tilt control, game controllers, and menu navigation.',
  },
};
