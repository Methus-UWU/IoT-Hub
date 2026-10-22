import type { VirtualDevice } from '../../models/virtual-device.model';
import { numberState, type DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, line, path, rect, text, type Shape } from '../core/device-shape';
import { requiresSupply } from '../core/device-simulation';
import { servoFollower } from '../core/bus-peripherals';

/**
 * TowerPro SG90 micro servo, drawn from above.
 *
 * The top view keeps the horn sweep visible while using the slim 12.2 mm case
 * dimension. It occupies far less vertical canvas space than the old side view
 * while retaining the connector, wire loom and mounting flange.
 */

const BODY = bodyFromMm({ widthMm: 38, heightMm: 17 });
const HEIGHT = BODY.height;

const CONNECTOR_X = u(0.5);
const CONNECTOR_WIDTH = u(4.8);
const CASE_X = u(13.2);
const CASE_Y = u(4.2);
const CASE_WIDTH = u(20);
const CASE_HEIGHT = u(9.8);
const TAB_X = u(10.2);
const TAB_Y = u(6.1);
const TAB_WIDTH = u(27);
const TAB_HEIGHT = u(5.8);

const SHAFT_X = u(18.2);
const SHAFT_Y = u(9.1);
const HORN_R = u(8);

const LEAD_X = CONNECTOR_X;
const LEAD_TOP = HEIGHT / 2 - HEADER_PITCH;

const LEADS = [
  ['GND', 'gnd', '#6b4423', 'Ground, the brown lead'],
  ['VCC', 'vcc', '#dc2626', 'Supply, 4.8–6 V, the red lead'],
  ['PWM', 'pwm', '#f59e0b', 'Control pulse, 1–2 ms every 20 ms, the orange lead'],
] as const;

/** 0° points left, 90° straight up and 180° points right. */
function hornTip(angle: number, reach = HORN_R): { x: number; y: number } {
  const clamped = Math.min(Math.max(angle, 0), 180);
  const radians = ((180 - clamped) * Math.PI) / 180;
  return {
    x: SHAFT_X + Math.cos(radians) * reach,
    y: SHAFT_Y - Math.sin(radians) * reach,
  };
}

function hornHole(angle: number, reach: number): Shape {
  const point = hornTip(angle, reach);
  return circle(point.x, point.y, u(0.48), {
    fill: '#343a40',
    stroke: '#aeb4ba',
    strokeWidth: u(0.08),
    detail: 'normal',
  });
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const angle = numberState(context, 'angle', 90);
  const tip = hornTip(angle);
  const opposite = hornTip(angle, -HORN_R * 0.35);

  return [
    // Mounting flange behind the motor case.
    rect(TAB_X, TAB_Y, TAB_WIDTH, TAB_HEIGHT, {
      rx: u(0.45),
      fill: '#575b60',
      stroke: '#30343a',
      strokeWidth: u(0.14),
    }),
    circle(u(35.2), TAB_Y + TAB_HEIGHT / 2, u(1.35), {
      fill: '#2d3034',
      stroke: '#70757c',
      strokeWidth: u(0.12),
    }),

    // Three-colour loom; both ends tuck beneath the case and connector.
    ...LEADS.map(([, , color], index) => {
      const connectorY = LEAD_TOP + index * HEADER_PITCH;
      const caseY = u(8) + index * u(1.15);
      return path(
        `M ${CONNECTOR_X + CONNECTOR_WIDTH} ${connectorY} ` +
          `C ${u(8)} ${connectorY}, ${u(9.5)} ${caseY}, ${CASE_X + u(1)} ${caseY}`,
        {
          fill: 'none',
          stroke: color,
          strokeWidth: u(0.62),
          strokeLinecap: 'round',
        },
      );
    }),

    // Slim top-view case.
    rect(CASE_X, CASE_Y, CASE_WIDTH, CASE_HEIGHT, {
      rx: u(1),
      fill: '#686b70',
      stroke: '#363a40',
      strokeWidth: u(0.16),
    }),
    rect(CASE_X + u(0.25), CASE_Y + u(0.25), CASE_WIDTH - u(0.5), u(1.15), {
      rx: u(0.55),
      fill: '#7b7e83',
      opacity: 0.75,
      detail: 'normal',
    }),
    line(u(28.2), CASE_Y + u(0.4), u(28.2), CASE_Y + CASE_HEIGHT - u(0.4), {
      stroke: '#4c5055',
      strokeWidth: u(0.18),
      detail: 'normal',
    }),
    text(u(30), CASE_Y + CASE_HEIGHT - u(1), 'SG90', {
      size: u(0.82),
      fill: SILK.white,
      anchor: 'middle',
      mono: true,
      weight: 600,
      detail: 'high',
    }),

    // Gearbox boss and movable horn.
    circle(SHAFT_X, SHAFT_Y, u(4.1), {
      fill: '#85888c',
      stroke: '#52565b',
      strokeWidth: u(0.14),
    }),
    circle(SHAFT_X, SHAFT_Y, u(3.15), {
      fill: '#bfc2c5',
      stroke: '#777c82',
      strokeWidth: u(0.12),
    }),
    path(`M ${tip.x} ${tip.y} L ${opposite.x} ${opposite.y}`, {
      fill: 'none',
      stroke: '#d1d4d6',
      strokeWidth: u(2.15),
      strokeLinecap: 'round',
    }),
    ...[u(3.2), u(4.8), u(6.35), u(7.65)].map((reach) => hornHole(angle, reach)),
    circle(SHAFT_X, SHAFT_Y, u(1.65), {
      fill: '#d8dadd',
      stroke: '#8b9096',
      strokeWidth: u(0.15),
    }),
    line(SHAFT_X - u(0.75), SHAFT_Y - u(0.75), SHAFT_X + u(0.75), SHAFT_Y + u(0.75), {
      stroke: '#777c82',
      strokeWidth: u(0.24),
      strokeLinecap: 'round',
    }),
    line(SHAFT_X + u(0.75), SHAFT_Y - u(0.75), SHAFT_X - u(0.75), SHAFT_Y + u(0.75), {
      stroke: '#777c82',
      strokeWidth: u(0.24),
      strokeLinecap: 'round',
    }),

    // Three-position connector shell and its contacts.
    rect(CONNECTOR_X, LEAD_TOP - u(1.2), CONNECTOR_WIDTH, HEADER_PITCH * 2 + u(2.4), {
      rx: u(0.3),
      fill: '#4a4d52',
      stroke: OUTLINE,
      strokeWidth: u(0.12),
    }),
    ...LEADS.flatMap((_, index) => {
      const y = LEAD_TOP + index * HEADER_PITCH;
      return [
        rect(CONNECTOR_X + u(0.85), y - u(0.45), u(2.5), u(0.9), {
          fill: '#171a1e',
          stroke: '#787d84',
          strokeWidth: u(0.08),
        }),
        rect(CONNECTOR_X + u(1.05), y - u(0.16), u(1.9), u(0.32), {
          fill: '#b8bec5',
        }),
      ];
    }),
  ];
}

export const SG90_SERVO: VirtualDevice = {
  id: 'servo',
  name: 'Servo motor',
  model: 'TowerPro SG90',
  description: 'PWM-controlled actuator with a shared ground.',
  x: 704,
  y: 484,
  ...BODY,
  operatingVoltage: { min: 4.8, max: 6, recommended: 5 },
  interfaces: ['pwm', 'power'],
  properties: [
    {
      id: 'angle',
      label: 'Angle',
      kind: 'number',
      defaultValue: 90,
      min: 0,
      max: 180,
      step: 1,
      unit: '°',
      group: 'simulation',
      description: 'Commanded horn position. An SG90 sweeps 0–180°.',
    },
  ],
  pins: LEADS.map(([name, type, , detail], index) =>
    pin(name, LEAD_X, LEAD_TOP + index * HEADER_PITCH, type, {
      side: 'left',
      direction: name === 'PWM' ? 'input' : undefined,
      description: detail,
      voltage: name === 'VCC' ? 5 : undefined,
    }),
  ),
  render: { draw },
  // Turns to what the sketch's Servo.write() sends; needs its 5 V to move.
  simulation: requiresSupply(servoFollower('PWM'), { minimumVolts: 4 }),
  catalog: {
    categoryId: 'motors-actuators',
    category: 'Motors & Actuators',
    aliases: ['micro servo', 'RC servo', '9 gram servo'],
    tags: ['servo', 'motor', 'actuator', 'PWM', 'SG90', 'output'],
    interfaceLabel: 'PWM · 3 pins',
    typicalUsage: 'Small mechanisms, gauges, locks, and positional control.',
  },
};
