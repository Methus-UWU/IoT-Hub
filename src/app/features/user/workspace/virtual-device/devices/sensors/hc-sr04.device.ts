import type { VirtualDevice } from '../../models/virtual-device.model';
import { numberState, type DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { PCB, SILK } from '../core/device-palette';
import { maleHeader, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, path, rect, repeat, text, type Shape } from '../core/device-shape';
import { requiresSupply } from '../core/device-simulation';

/**
 * HC-SR04 ultrasonic ranging module.
 *
 * The two 16 mm transducer cans are the whole silhouette of this part — they
 * are why it is instantly recognisable — so they are drawn at their real
 * diameter on a real 45 × 20 mm board. Getting that right also fixes the pin
 * spacing for free: the 4-pin header is 0.1 in pitch, which is 7.6 mm of a
 * 45 mm board, and that ratio is what the eye actually checks.
 *
 * The finish deliberately follows the flat, high-contrast reading a simulator
 * diagram wants rather than a photographic one: solid fills, a white can rim
 * against a black baffle, and a checkered mesh face. Flat colour also means the
 * part draws identically wherever it appears, with no gradient definitions to
 * resolve.
 *
 * What is left over once the cans are placed is a 5.8 mm channel down the
 * middle, and that channel is the whole design problem: the oscillator can, the
 * part number and four pin names all have to live in it. Every dimension below
 * is measured off that channel rather than guessed, which is why nothing
 * collides with the cans.
 */

const BODY = bodyFromMm({ widthMm: 45, heightMm: 20 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

/** Transducer can centres and radius, from the physical part. */
const CAN_R = u(8);
const TX_X = u(11.6);
const RX_X = u(33.4);
const CAN_Y = u(8);

/** The clear channel between the cans — everything else is fitted into it. */
const CHANNEL_X = TX_X + CAN_R;
const CHANNEL_WIDTH = RX_X - CAN_R - CHANNEL_X;
const CHANNEL_CENTER = CHANNEL_X + CHANNEL_WIDTH / 2;

/** Board colours. Flat, so nothing here depends on a gradient resolving. */
const CAN_RIM = '#eef1f4';
const CAN_BAFFLE = '#15181c';
const MESH_DARK = '#5f6771';
const MESH_LIGHT = '#8d959f';
const HOLE_PAD = '#17497b';

/** M3-ish mounting holes, one per corner. */
const HOLE_R = u(1);
const HOLE_INSET = u(2.4);
const HOLES = [
  [HOLE_INSET, HOLE_INSET],
  [WIDTH - HOLE_INSET, HOLE_INSET],
  [HOLE_INSET, HEIGHT - HOLE_INSET],
  [WIDTH - HOLE_INSET, HEIGHT - HOLE_INSET],
] as const;

const PINS = [
  ['VCC', 'vcc', 'Supply, 5 V'],
  ['TRIG', 'digital', 'Trigger input: a 10 µs pulse starts a measurement'],
  ['ECHO', 'digital', 'Echo output: pulse width is proportional to distance'],
  ['GND', 'gnd', 'Ground reference'],
] as const;

const HEADER_X = (WIDTH - HEADER_PITCH * (PINS.length - 1)) / 2;
const HEADER_Y = HEIGHT - u(1.4);

/**
 * The board outline with its four holes punched out of it.
 *
 * The holes are subpaths of the substrate itself under `evenodd`, not dark
 * circles painted on top. That is the difference between a hole and a picture
 * of one: whatever is behind the part — canvas, grid, a wire routed underneath
 * — shows through, and it keeps showing through when the part is dragged.
 */
function boardPath(): string {
  const radius = u(0.8);
  const outline =
    `M ${radius} 0 H ${WIDTH - radius} A ${radius} ${radius} 0 0 1 ${WIDTH} ${radius}` +
    ` V ${HEIGHT - radius} A ${radius} ${radius} 0 0 1 ${WIDTH - radius} ${HEIGHT}` +
    ` H ${radius} A ${radius} ${radius} 0 0 1 0 ${HEIGHT - radius}` +
    ` V ${radius} A ${radius} ${radius} 0 0 1 ${radius} 0 Z`;
  const holes = HOLES.map(
    ([cx, cy]) =>
      ` M ${cx - HOLE_R} ${cy} A ${HOLE_R} ${HOLE_R} 0 1 0 ${cx + HOLE_R} ${cy}` +
      ` A ${HOLE_R} ${HOLE_R} 0 1 0 ${cx - HOLE_R} ${cy} Z`,
  ).join('');

  return outline + holes;
}

/**
 * The checkered gauze over a transducer.
 *
 * Cells are laid on a square grid and kept only where the whole cell falls
 * inside the face, so the disc below shows through as the other half of the
 * pattern and no square hangs over the baffle. Testing the far corner rather
 * than the centre is what guarantees that — a centre test lets corner cells
 * poke out by half a cell.
 */
function mesh(cx: number, radius: number): readonly Shape[] {
  const cell = u(1);
  const span = Math.floor(radius / cell);
  const cells: Shape[] = [];

  for (let row = -span; row <= span; row++) {
    for (let column = -span; column <= span; column++) {
      if ((row + column) % 2 !== 0) continue;
      const x = column * cell;
      const y = row * cell;
      // The corner of this cell furthest from the centre. Taking the larger of
      // the two edges per axis is the whole trick: adding a cell to both would
      // over-shrink the pattern into a diamond well inside the face.
      const far = Math.hypot(
        Math.max(Math.abs(x), Math.abs(x + cell)),
        Math.max(Math.abs(y), Math.abs(y + cell)),
      );
      if (far > radius) continue;
      cells.push(rect(cx + x, CAN_Y + y, cell, cell, { fill: MESH_LIGHT, detail: 'normal' }));
    }
  }

  return cells;
}

/**
 * One 16 mm transducer: white rim, black baffle, checkered face.
 *
 * The rim and the baffle are what carry the part at a glance — two hard rings
 * of opposite value. Draw them in neighbouring greys instead and the pair
 * collapses into one flat disc, which is the failure mode of every
 * schematic-style ultrasonic drawing.
 */
function transducer(cx: number, label: string): readonly Shape[] {
  const baffleR = CAN_R - u(1.3);
  const faceR = CAN_R - u(2.6);

  return [
    circle(cx, CAN_Y, CAN_R, {
      fill: CAN_RIM,
      stroke: '#c6ccd3',
      strokeWidth: u(0.2),
    }),
    circle(cx, CAN_Y, baffleR, { fill: CAN_BAFFLE }),
    circle(cx, CAN_Y, faceR, { fill: MESH_DARK }),
    ...mesh(cx, faceR),

    // T / R, printed on the face. Held at `high` so it never fights the
    // artwork at working zoom.
    silkLabel(cx, CAN_Y + u(3.6), label, {
      size: u(1.4),
      fill: '#c3cad2',
      detail: 'high',
    }),
  ];
}

/**
 * A wavefront: the arc of a circle centred on one can, drawn across the top.
 *
 * Sweeping a true circular arc rather than eyeballing a bezier is what keeps
 * the three fronts concentric — the moment they stop sharing a centre they read
 * as decoration instead of as sound leaving the transducer.
 */
function wavefront(cx: number, radius: number): string {
  const point = (degrees: number): string => {
    const radians = (degrees * Math.PI) / 180;
    return `${cx + radius * Math.cos(radians)} ${CAN_Y + radius * Math.sin(radians)}`;
  };
  return `M ${point(215)} A ${radius} ${radius} 0 0 1 ${point(325)}`;
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const distance = numberState(context, 'distance', 50);
  // The echo cone only means something while the module is running on real
  // power; drawing it otherwise would claim a reading it has not taken.
  const sounding = context.running && context.state['powered'] === true;
  // A near target packs the wavefronts together, a far one spreads them out.
  const reach = Math.min(distance, 400) / 400;

  return [
    path(boardPath(), {
      fill: PCB.blue,
      fillRule: 'evenodd',
      stroke: PCB.blueDark,
      strokeWidth: u(0.25),
    }),
    // Plating around each hole. A ring, so the bore stays open.
    ...HOLES.map(([cx, cy]) =>
      circle(cx, cy, HOLE_R + u(0.4), {
        fill: 'none',
        stroke: HOLE_PAD,
        strokeWidth: u(0.8),
        detail: 'normal',
      }),
    ),

    ...transducer(TX_X, 'T'),
    ...transducer(RX_X, 'R'),

    // Oscillator can, the one part of the front side that is not a transducer.
    rect(CHANNEL_CENTER - u(2.2), u(1.2), u(4.4), u(2.1), {
      rx: u(1.05),
      fill: '#a7aeb6',
      stroke: '#7d848c',
      strokeWidth: u(0.15),
    }),

    silkLabel(CHANNEL_CENTER, u(7.2), 'HC-SR04', {
      size: u(1.05),
      fill: SILK.white,
      detail: 'normal',
    }),

    // Echo cone: wavefronts leaving the transmitter and one returning into the
    // receiver, spaced by the measured distance so a near target visibly
    // differs from a far one.
    ...(sounding
      ? [
          ...repeat(
            3,
            {},
            (index) =>
              path(wavefront(TX_X, CAN_R + u(1.6) + index * u(1.9) + reach * u(3.5)), {
                fill: 'none',
                stroke: '#7dd3fc',
                strokeWidth: u(0.3),
                strokeLinecap: 'round',
                opacity: 0.62 - index * 0.17,
                detail: 'normal',
              }),
            {},
          ),
          // The return leg, drawn thinner and dimmer: it is the same sound, but
          // what comes back off a target is a fraction of what went out.
          path(wavefront(RX_X, CAN_R + u(1.6)), {
            fill: 'none',
            stroke: '#bae6fd',
            strokeWidth: u(0.22),
            strokeLinecap: 'round',
            opacity: 0.38,
            detail: 'normal',
          }),
        ]
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
  // No echo timing is modelled; the behaviour exists so the cone needs real power.
  simulation: requiresSupply(() => ({}), { minimumVolts: 4.5 }),
  catalog: {
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: ['sonar', 'distance sensor', 'range finder'],
    tags: ['ultrasonic', 'distance', 'proximity', 'echo', 'HC-SR04', 'sensor', 'digital'],
    interfaceLabel: 'ทริกเกอร์ / เอคโค · 4 ขา',
    typicalUsage: 'Obstacle detection, tank level sensing, and distance measurement.',
  },
};
