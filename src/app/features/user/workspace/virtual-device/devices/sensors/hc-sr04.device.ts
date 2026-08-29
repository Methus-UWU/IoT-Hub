import type { VirtualDevice } from '../../models/virtual-device.model';
import { numberState, type DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, PART, PCB, SILK } from '../core/device-palette';
import { chip, maleHeader, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, path, rect, repeat, text, type Shape } from '../core/device-shape';

/**
 * HC-SR04 ultrasonic ranging module.
 *
 * The two 16 mm transducer cans are the whole silhouette of this part — they
 * are why it is instantly recognisable — so they are drawn at their real
 * diameter on a real 45 × 20 mm board. Getting that right also fixes the pin
 * spacing for free: the 4-pin header is 0.1 in pitch, which is 7.6 mm of a
 * 45 mm board, and that ratio is what the eye actually checks.
 */

const BODY = bodyFromMm({ widthMm: 45, heightMm: 20 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

/** Transducer can centres and radius, from the physical part. */
const CAN_R = u(8);
const TX_X = u(11.5);
const RX_X = u(33.5);
const CAN_Y = u(8.5);

const PINS = [
  ['VCC', 'vcc', 'Supply, 5 V'],
  ['TRIG', 'digital', 'Trigger input: a 10 µs pulse starts a measurement'],
  ['ECHO', 'digital', 'Echo output: pulse width is proportional to distance'],
  ['GND', 'gnd', 'Ground reference'],
] as const;

const HEADER_X = (WIDTH - HEADER_PITCH * (PINS.length - 1)) / 2;
const HEADER_Y = HEIGHT - u(1.4);

function draw(context: DeviceDrawContext): readonly Shape[] {
  const distance = numberState(context, 'distance', 50);
  // The echo cone only means something while the sim is running; drawing it on
  // a stopped canvas would claim a reading the module has not taken.
  const sounding = context.running;

  return [
    rect(0, 0, WIDTH, HEIGHT, {
      rx: u(0.5),
      fill: PCB.blue,
      stroke: PCB.blueDark,
      strokeWidth: u(0.2),
    }),

    // Transducers: aluminium cans with a mesh face and a rim.
    ...[TX_X, RX_X].flatMap((cx) => [
      circle(cx, CAN_Y, CAN_R, {
        fill: PART.metal,
        stroke: PART.metalDark,
        strokeWidth: u(0.25),
      }),
      circle(cx, CAN_Y, CAN_R - u(1), {
        fill: '#8f969f',
        stroke: PART.metalDark,
        strokeWidth: u(0.12),
        detail: 'normal',
      }),
      // Mesh, drawn as concentric rings rather than a dot field so it stays
      // cheap at every zoom level.
      ...repeat(
        3,
        {},
        (index) =>
          circle(cx, CAN_Y, CAN_R - u(2.2) - index * u(1.4), {
            fill: 'none',
            stroke: '#6f767f',
            strokeWidth: u(0.15),
            detail: 'high',
          }),
        {},
      ),
      circle(cx, CAN_Y, u(0.7), { fill: '#5a6069', detail: 'normal' }),
    ]),

    // T and R silkscreen, as printed between the cans on a real module.
    silkLabel(TX_X, CAN_Y + u(0.5), 'T', { size: u(1.6), fill: '#5f666f', detail: 'normal' }),
    silkLabel(RX_X, CAN_Y + u(0.5), 'R', { size: u(1.6), fill: '#5f666f', detail: 'normal' }),

    // Controller and the 40 kHz driver, on the strip of board the cans leave.
    ...chip(u(20), u(1.6), u(5), u(4.4), 'EM', { labelSize: u(0.8) }),
    ...chip(u(20), u(7), u(5), u(4), 'MAX', { labelSize: u(0.7) }),
    rect(u(19.2), u(12), u(2.6), u(1.4), {
      rx: u(0.2),
      fill: PART.crystal,
      stroke: PART.metalDark,
      strokeWidth: u(0.1),
      detail: 'high',
    }),

    silkLabel(WIDTH / 2, u(15.4), 'HC-SR04', {
      size: u(1),
      fill: SILK.white,
      detail: 'normal',
    }),

    // Echo cone. Arcs spreading from the transmitter, spaced by the measured
    // distance so a near target visibly differs from a far one.
    ...(sounding
      ? repeat(
          3,
          {},
          (index) => {
            const spread = u(2) + index * u(1.6) + Math.min(distance, 200) / 40;
            return path(
              `M ${TX_X - spread * 0.7} ${CAN_Y - spread} A ${spread} ${spread} 0 0 1 ${
                TX_X + spread * 0.7
              } ${CAN_Y - spread}`,
              {
                fill: 'none',
                stroke: '#7dd3fc',
                strokeWidth: u(0.25),
                strokeLinecap: 'round',
                opacity: 0.55 - index * 0.13,
                detail: 'normal',
              },
            );
          },
          {},
        )
      : []),

    // Four-pin header along the bottom edge.
    ...maleHeader(HEADER_X, HEADER_Y, PINS.length, 'horizontal'),
    ...PINS.map(([name], index) =>
      text(HEADER_X + index * HEADER_PITCH, HEADER_Y - u(1.9), name, {
        size: u(0.8),
        fill: SILK.white,
        anchor: 'middle',
        mono: true,
        weight: 600,
        detail: 'normal',
      }),
    ),
  ];
}

export const HC_SR04: VirtualDevice = {
  id: 'ultrasonic',
  name: 'Distance sensor',
  model: 'HC-SR04',
  description: 'Measures distance using trigger and echo signals.',
  x: 692,
  y: 58,
  ...BODY,
  // The module prints VCC/TRIG/ECHO/GND above its header, so hide the overlay.
  printsOwnPinLabels: true,
  operatingVoltage: { min: 4.5, max: 5.5, recommended: 5 },
  interfaces: ['digital', 'power'],
  properties: [
    {
      id: 'distance',
      label: 'ระยะวัตถุ',
      kind: 'number',
      defaultValue: 50,
      min: 2,
      max: 400,
      step: 1,
      unit: 'cm',
      group: 'simulation',
      description: 'Distance to the target the sensor is pointed at. 2–400 cm is its usable range.',
    },
  ],
  pins: PINS.map(([name, type, detail], index) =>
    pin(name, HEADER_X + index * HEADER_PITCH, HEADER_Y, type, {
      side: 'bottom',
      description: detail,
      voltage: name === 'VCC' ? 5 : undefined,
    }),
  ),
  render: { draw },
  catalog: {
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: ['sonar', 'distance sensor', 'range finder'],
    tags: ['ultrasonic', 'distance', 'proximity', 'echo', 'HC-SR04', 'sensor', 'digital'],
    interfaceLabel: 'ทริกเกอร์ / เอคโค · 4 ขา',
    typicalUsage: 'Obstacle detection, tank level sensing, and distance measurement.',
  },
};
