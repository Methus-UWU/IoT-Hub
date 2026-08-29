import type { VirtualDevice } from '../../models/virtual-device.model';
import { booleanState, type DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, u } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import { silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, path, rect, type Shape } from '../core/device-shape';

/**
 * Small brushed DC motor, the RF-300-class can found in every hobby kit.
 *
 * Drawn from the side: a 24.4 mm can with the output shaft out of one end and
 * the two solder tabs out of the other. That view is the one that makes the
 * shaft — the thing the user is going to attach something to — visible, and it
 * puts the terminals where a wire can reach them without crossing the body.
 */

const BODY = bodyFromMm({ widthMm: 44, heightMm: 24.4 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

const CENTRE_Y = HEIGHT / 2;
/** Can body: 30 mm long, starting clear of the terminal tabs. */
const CAN_X = u(4);
const CAN_WIDTH = u(30);
/** Output shaft: 2 mm across, 10 mm proud of the end bell. */
const SHAFT_X = CAN_X + CAN_WIDTH;

const TERMINALS = [
  ['M+', 'passive', 'Motor terminal. Swapping the two reverses rotation'],
  ['M−', 'passive', 'Motor terminal. Swapping the two reverses rotation'],
] as const;

const TERMINAL_X = u(1);
const TERMINAL_SPACING = u(10);

function draw(context: DeviceDrawContext): readonly Shape[] {
  const spinning = context.running && !booleanState(context, 'stalled', false);

  return [
    // Solder tabs on the end bell.
    ...TERMINALS.map((_, index) =>
      rect(
        0,
        CENTRE_Y + (index === 0 ? -TERMINAL_SPACING : TERMINAL_SPACING) - u(1),
        u(5),
        u(2),
        { rx: u(0.3), fill: PART.copper, stroke: PART.metalDark, strokeWidth: u(0.12) },
      ),
    ),

    // Steel can.
    rect(CAN_X, 0, CAN_WIDTH, HEIGHT, {
      rx: u(2),
      fill: PART.metal,
      stroke: PART.metalDark,
      strokeWidth: u(0.25),
    }),
    // Crimp seams at each end, where the end bells are rolled into the can.
    rect(CAN_X + u(2.5), 0, u(0.4), HEIGHT, { fill: PART.metalDark, opacity: 0.5, detail: 'normal' }),
    rect(CAN_X + CAN_WIDTH - u(2.9), 0, u(0.4), HEIGHT, {
      fill: PART.metalDark,
      opacity: 0.5,
      detail: 'normal',
    }),
    // Flat face highlight — a rolled steel can catches light along its length.
    rect(CAN_X + u(1), u(3), CAN_WIDTH - u(2), u(4), {
      rx: u(2),
      fill: PART.metalLight,
      opacity: 0.5,
      detail: 'normal',
    }),

    silkLabel(CAN_X + CAN_WIDTH / 2, CENTRE_Y + u(1), 'DC 3–6V', {
      size: u(2),
      fill: '#5b6472',
      weight: 700,
      detail: 'normal',
    }),

    // Bearing boss and output shaft.
    circle(SHAFT_X, CENTRE_Y, u(3), {
      fill: PART.metalDark,
      stroke: OUTLINE,
      strokeWidth: u(0.15),
    }),
    rect(SHAFT_X, CENTRE_Y - u(1), u(10), u(2), {
      rx: u(0.3),
      fill: PART.metalLight,
      stroke: PART.metalDark,
      strokeWidth: u(0.12),
    }),

    // Rotation arrow, only while the motor is actually turning. It rings the
    // shaft boss, so it reads as the shaft moving rather than as a stray circle
    // drawn over the can.
    ...(spinning
      ? [
          path(
            `M ${SHAFT_X} ${CENTRE_Y - u(4.4)}` +
              ` A ${u(4.4)} ${u(4.4)} 0 1 1 ${SHAFT_X - u(4.4)} ${CENTRE_Y}`,
            {
              fill: 'none',
              stroke: '#38bdf8',
              strokeWidth: u(0.35),
              strokeLinecap: 'round',
              opacity: 0.9,
              detail: 'normal',
            },
          ),
          path(
            `M ${SHAFT_X - u(5.4)} ${CENTRE_Y - u(0.9)} L ${SHAFT_X - u(4.4)} ${
              CENTRE_Y + u(0.3)
            } L ${SHAFT_X - u(3.3)} ${CENTRE_Y - u(0.7)}`,
            {
              fill: 'none',
              stroke: '#38bdf8',
              strokeWidth: u(0.35),
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              detail: 'normal',
            },
          ),
        ]
      : []),

    // Terminal polarity marks.
    silkLabel(u(2.5), CENTRE_Y - TERMINAL_SPACING - u(1.6), '+', {
      size: u(1.6),
      fill: SILK.dim,
      detail: 'high',
    }),
    silkLabel(u(2.5), CENTRE_Y + TERMINAL_SPACING + u(3.2), '−', {
      size: u(1.6),
      fill: SILK.dim,
      detail: 'high',
    }),
  ];
}

export const DC_MOTOR: VirtualDevice = {
  id: 'dc-motor',
  name: 'DC motor',
  model: 'RF-300 · 3–6 V brushed',
  description: 'Two-wire brushed motor for continuous bidirectional rotation.',
  x: 690,
  y: 330,
  ...BODY,
  initiallyVisible: false,
  operatingVoltage: { min: 3, max: 6, recommended: 5 },
  interfaces: ['passive', 'power'],
  properties: [
    {
      id: 'stalled',
      label: 'ล็อกเพลา',
      kind: 'boolean',
      defaultValue: false,
      group: 'simulation',
      description: 'Holds the shaft. A stalled motor draws far more current than a spinning one.',
    },
  ],
  pins: TERMINALS.map(([name, type, detail], index) =>
    pin(
      name,
      TERMINAL_X,
      CENTRE_Y + (index === 0 ? -TERMINAL_SPACING : TERMINAL_SPACING),
      type,
      { side: 'left', description: detail },
    ),
  ),
  render: { draw },
  catalog: {
    categoryId: 'motors-actuators',
    category: 'Motors & Actuators',
    aliases: ['brushed motor', 'toy motor', 'DC motor 3V', 'DC motor 6V'],
    tags: ['motor', 'DC', 'brushed', 'actuator', 'output', '3V', '6V'],
    interfaceLabel: 'DC แบบ 2 สาย',
    typicalUsage: 'Wheels, fans, pumps, and other continuous-motion mechanisms.',
  },
};
