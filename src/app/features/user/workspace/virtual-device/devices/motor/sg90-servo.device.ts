import type { VirtualDevice } from '../../models/virtual-device.model';
import { numberState, type DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { mountingHole, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, path, rect, type Shape } from '../core/device-shape';

/**
 * TowerPro SG90 micro servo, drawn from the side.
 *
 * Side-on is the only view that shows what a servo actually does: the output
 * horn sweeps in the plane of the drawing, so the angle property is visible as
 * an angle rather than as a number printed on a box. The case is the real
 * 22.8 × 22.7 mm with its mounting tabs spanning 32.2 mm, which is what makes a
 * servo read as roughly one-and-a-half times the height of an HC-SR04 board —
 * as it does on a desk.
 */

const BODY = bodyFromMm({ widthMm: 32.2, heightMm: 31 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

/** Case, centred between the mounting tabs. */
const CASE_X = u(4.7);
const CASE_WIDTH = u(22.8);
const TAB_Y = u(8);
const TAB_HEIGHT = u(3);
const CASE_TOP = TAB_Y;
const CASE_BOTTOM = HEIGHT - u(0.3);

/** Output shaft: offset toward the gear end, as on the real case. */
const SHAFT_X = u(10.5);
const SHAFT_Y = TAB_Y;
/** Horn arm length from the shaft centre. */
const HORN_R = u(8);

/** The three lead wires leave the right-hand side of the case. */
const LEAD_X = WIDTH + u(3.5);
const LEAD_TOP = HEIGHT / 2 - HEADER_PITCH;

const LEADS = [
  ['GND', 'gnd', '#6b4423', 'Ground, the brown lead'],
  ['VCC', 'vcc', '#dc2626', 'Supply, 4.8–6 V, the red lead'],
  ['PWM', 'pwm', '#f59e0b', 'Control pulse, 1–2 ms every 20 ms, the orange lead'],
] as const;

/**
 * Where the horn points for a commanded angle.
 *
 * 0° points left, 90° straight up, 180° right — the sweep an SG90 makes when
 * viewed from this side with the output shaft nearest the viewer.
 */
function hornTip(angle: number, reach = HORN_R): { x: number; y: number } {
  // Only the commanded angle is clamped. The opposite arm is derived by negating
  // the reach rather than by adding 180°, which the clamp would fold back on
  // itself and leave the two arms meeting at a corner instead of in a line.
  const clamped = Math.min(Math.max(angle, 0), 180);
  const radians = ((180 - clamped) * Math.PI) / 180;
  return {
    x: SHAFT_X + Math.cos(radians) * reach,
    y: SHAFT_Y - Math.sin(radians) * reach,
  };
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const angle = numberState(context, 'angle', 90);
  const tip = hornTip(angle);
  // The SG90 ships with a double arm; the short side keeps the hub visible.
  const opposite = hornTip(angle, -HORN_R * 0.55);

  return [
    // Mounting tabs run the full width, behind the case.
    rect(0, TAB_Y, WIDTH, TAB_HEIGHT, {
      rx: u(0.6),
      fill: '#2f6fbf',
      stroke: '#1f4f8c',
      strokeWidth: u(0.15),
    }),
    mountingHole(u(2.1), TAB_Y + TAB_HEIGHT / 2, u(1)),
    mountingHole(WIDTH - u(2.1), TAB_Y + TAB_HEIGHT / 2, u(1)),

    // Case.
    rect(CASE_X, CASE_TOP, CASE_WIDTH, CASE_BOTTOM - CASE_TOP, {
      rx: u(0.8),
      fill: PART.plasticBlue,
      stroke: '#1f4f8c',
      strokeWidth: u(0.2),
    }),
    // Upper gearbox section, moulded in a lighter shade on the real part.
    rect(CASE_X, CASE_TOP, CASE_WIDTH, u(6), {
      rx: u(0.8),
      fill: '#3d81d1',
      stroke: '#1f4f8c',
      strokeWidth: u(0.15),
    }),
    // Case seam.
    rect(CASE_X, u(20), CASE_WIDTH, u(0.3), {
      fill: '#1f4f8c',
      opacity: 0.5,
      detail: 'normal',
    }),
    silkLabel(CASE_X + CASE_WIDTH / 2, u(25.5), 'SG90', {
      size: u(2),
      fill: SILK.white,
      weight: 700,
      detail: 'normal',
    }),
    silkLabel(CASE_X + CASE_WIDTH / 2, u(28.5), 'TowerPro', {
      size: u(1.2),
      fill: SILK.soft,
      detail: 'high',
    }),

    // Output boss and shaft.
    circle(SHAFT_X, SHAFT_Y, u(2.6), {
      fill: '#3d81d1',
      stroke: '#1f4f8c',
      strokeWidth: u(0.15),
    }),

    // Horn: a double arm, as the SG90 ships with. Drawn as a rounded bar
    // through the shaft so the sweep is legible at any zoom.
    path(`M ${tip.x} ${tip.y} L ${opposite.x} ${opposite.y}`, {
      fill: 'none',
      stroke: PART.plasticWhite,
      strokeWidth: u(1.6),
      strokeLinecap: 'round',
    }),
    circle(tip.x, tip.y, u(0.7), { fill: '#c9ced4', stroke: PART.metalDark, strokeWidth: u(0.1), detail: 'normal' }),
    circle(opposite.x, opposite.y, u(0.7), {
      fill: '#c9ced4',
      stroke: PART.metalDark,
      strokeWidth: u(0.1),
      detail: 'normal',
    }),
    circle(SHAFT_X, SHAFT_Y, u(1.1), {
      fill: PART.metalLight,
      stroke: PART.metalDark,
      strokeWidth: u(0.12),
    }),

    // Lead wires out of the right-hand face.
    ...LEADS.map(([, , color], index) =>
      path(
        `M ${CASE_X + CASE_WIDTH} ${u(14) + index * u(2)} ` +
          `C ${WIDTH} ${u(14) + index * u(2)}, ${WIDTH} ${LEAD_TOP + index * HEADER_PITCH}, ` +
          `${LEAD_X} ${LEAD_TOP + index * HEADER_PITCH}`,
        {
          fill: 'none',
          stroke: color,
          strokeWidth: u(0.7),
          strokeLinecap: 'round',
        },
      ),
    ),
    // Connector shell at the end of the loom.
    rect(LEAD_X - u(1.2), LEAD_TOP - u(1.6), u(2.4), HEADER_PITCH * 2 + u(3.2), {
      rx: u(0.3),
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: u(0.12),
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
      label: 'มุม',
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
      side: 'right',
      description: detail,
      voltage: name === 'VCC' ? 5 : undefined,
    }),
  ),
  render: { draw, bleed: { right: u(5) } },
  catalog: {
    categoryId: 'motors-actuators',
    category: 'Motors & Actuators',
    aliases: ['micro servo', 'RC servo', '9 gram servo'],
    tags: ['servo', 'motor', 'actuator', 'PWM', 'SG90', 'output'],
    interfaceLabel: 'PWM · 3 ขา',
    typicalUsage: 'Small mechanisms, gauges, locks, and positional control.',
  },
};
