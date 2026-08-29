import type { DevicePin, VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { u, UNITS_PER_MM } from '../core/device-metrics';
import { OUTLINE, PART } from '../core/device-palette';
import { PIN_PITCH } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { line, rect, repeat, text, type Shape } from '../core/device-shape';
import type { DeviceBehavior } from '../core/device-simulation';

/** Real breadboards are on a 0.1 in grid, the same pitch as every DIP part. */
const HOLE = PIN_PITCH;
/** Plastic border outside the outermost holes. */
const MARGIN = u(3.6);
/** Gap between a power rail pair and the terminal strips. */
const RAIL_GAP = u(3.6);
const RAVINE = HOLE * 2;

const ROW_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

interface BreadboardSize {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly columns: number;
  readonly powerRails: boolean;
}

/**
 * Node id for a hole, encoding the electrical net it belongs to.
 *
 * Terminal strips bond five holes in a column half (`col-3-top`); power rails
 * run the length of the board (`rail-top-plus`). Exposing this as an id means
 * the wiring engine can treat a breadboard as a real net without special-casing
 * breadboards anywhere in the canvas code.
 */
export function breadboardNode(pinName: string): string {
  const railMatch = /^([TB])([+-])(\d+)$/.exec(pinName);
  if (railMatch) {
    return `rail-${railMatch[1] === 'T' ? 'top' : 'bottom'}-${
      railMatch[2] === '+' ? 'plus' : 'minus'
    }`;
  }
  const holeMatch = /^([A-J])(\d+)$/.exec(pinName);
  if (!holeMatch) return pinName;
  const row = holeMatch[1];
  // A–E form the upper strip, F–J the lower; the ravine isolates the two.
  const half = ROW_LETTERS.indexOf(row as (typeof ROW_LETTERS)[number]) < 5 ? 'top' : 'bottom';
  return `col-${holeMatch[2]}-${half}`;
}

function createBreadboard(size: BreadboardSize): VirtualDevice {
  const { columns, powerRails } = size;
  const width = MARGIN * 2 + columns * HOLE;
  const railBlockHeight = powerRails ? HOLE * 2 + RAIL_GAP : 0;
  const stripHeight = HOLE * 5;
  const height = MARGIN * 2 + railBlockHeight * 2 + stripHeight * 2 + RAVINE;

  const topRailY = MARGIN;
  const upperStripY = MARGIN + railBlockHeight;
  const lowerStripY = upperStripY + stripHeight + RAVINE;
  const bottomRailY = lowerStripY + stripHeight + RAIL_GAP;

  const holeX = (column: number) => MARGIN + HOLE / 2 + column * HOLE;

  const pins: DevicePin[] = [];

  // Terminal strips: ten rows, five per half.
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < 10; row++) {
      const upper = row < 5;
      const y = (upper ? upperStripY : lowerStripY) + (upper ? row : row - 5) * HOLE + HOLE / 2;
      pins.push(
        pin(`${ROW_LETTERS[row]}${column + 1}`, holeX(column), y, 'passive', {
          description: `Terminal strip, column ${column + 1} ${upper ? 'upper' : 'lower'} half`,
        }),
      );
    }
  }

  // Power rails. Real rails skip a hole every five columns; the electrical
  // node is continuous either way, so the artwork shows the gap and the pins
  // simply follow the same grid.
  if (powerRails) {
    for (let column = 0; column < columns; column++) {
      pins.push(
        pin(`T+${column + 1}`, holeX(column), topRailY + HOLE / 2, 'vcc', {
          description: 'Top positive rail',
        }),
        pin(`T-${column + 1}`, holeX(column), topRailY + HOLE * 1.5, 'gnd', {
          description: 'Top negative rail',
        }),
        pin(`B+${column + 1}`, holeX(column), bottomRailY + HOLE / 2, 'vcc', {
          description: 'Bottom positive rail',
        }),
        pin(`B-${column + 1}`, holeX(column), bottomRailY + HOLE * 1.5, 'gnd', {
          description: 'Bottom negative rail',
        }),
      );
    }
  }

  function hole(x: number, y: number): Shape {
    return rect(x - u(0.75), y - u(0.75), u(1.5), u(1.5), {
      rx: u(0.2),
      fill: '#7d838c',
      detail: 'normal',
    });
  }

  function railRow(y: number, positive: boolean): readonly Shape[] {
    const color = positive ? '#dc2626' : '#2563eb';
    return [
      line(MARGIN - u(1.2), y, width - MARGIN + u(1.2), y, {
        stroke: color,
        strokeWidth: u(0.2),
        opacity: 0.55,
        detail: 'normal',
      }),
      text(MARGIN - u(1.8), y + u(0.6), positive ? '+' : '−', {
        size: u(1.8),
        fill: color,
        anchor: 'end',
        weight: 700,
      }),
      text(width - MARGIN + u(1.8), y + u(0.6), positive ? '+' : '−', {
        size: u(1.8),
        fill: color,
        anchor: 'start',
        weight: 700,
      }),
    ];
  }

  function draw(_context: DeviceDrawContext): readonly Shape[] {
    return [
      rect(0, 0, width, height, {
        rx: u(1),
        fill: '#f0ece2',
        stroke: '#c9c3b4',
        strokeWidth: u(0.2),
      }),

      // Central ravine that isolates the two halves.
      rect(MARGIN - u(0.9), upperStripY + stripHeight, width - (MARGIN - u(0.9)) * 2, RAVINE, {
        fill: '#e2ddd0',
        stroke: '#cdc7b8',
        strokeWidth: u(0.15),
      }),

      // Power rail markings.
      ...(powerRails
        ? [
            ...railRow(topRailY + HOLE / 2, true),
            ...railRow(topRailY + HOLE * 1.5, false),
            ...railRow(bottomRailY + HOLE / 2, true),
            ...railRow(bottomRailY + HOLE * 1.5, false),
          ]
        : []),

      // Holes.
      ...repeat(columns, { x: HOLE }, (column, x) => [
        ...repeat(5, { y: HOLE }, (_, __, y) => hole(x, y), {
          x: 0,
          y: upperStripY + HOLE / 2,
        }),
        ...repeat(5, { y: HOLE }, (_, __, y) => hole(x, y), {
          x: 0,
          y: lowerStripY + HOLE / 2,
        }),
        ...(powerRails
          ? [
              hole(x, topRailY + HOLE / 2),
              hole(x, topRailY + HOLE * 1.5),
              hole(x, bottomRailY + HOLE / 2),
              hole(x, bottomRailY + HOLE * 1.5),
            ]
          : []),
        // Column numbers every fifth column, as printed on a real board.
        ...((column + 1) % 5 === 0
          ? [
              text(x, upperStripY - u(0.6), String(column + 1), {
                size: u(1.2),
                fill: '#9a9384',
                anchor: 'middle',
                mono: true,
                detail: 'high',
              }),
            ]
          : []),
      ], { x: MARGIN + HOLE / 2, y: 0 }),

      // Row letters down both edges.
      ...ROW_LETTERS.map((letter, row) => {
        const upper = row < 5;
        const y =
          (upper ? upperStripY : lowerStripY) + (upper ? row : row - 5) * HOLE + HOLE / 2 + u(0.42);
        return text(MARGIN - u(1.4), y, letter, {
          size: u(1.2),
          fill: '#9a9384',
          anchor: 'end',
          mono: true,
          detail: 'high',
        });
      }),
    ];
  }

  return {
    id: size.id,
    name: size.name,
    model: size.model,
    description: `Solderless prototyping board with ${columns} columns${
      powerRails ? ' and four power rails' : ''
    }.`,
    x: 40,
    y: 40,
    width,
    height,
    // The board is laid out directly on the 0.1 in grid, so its millimetres are
    // whatever that grid adds up to rather than a separately typed figure that
    // could drift away from it.
    physicalSize: { widthMm: width / UNITS_PER_MM, heightMm: height / UNITS_PER_MM },
    initiallyVisible: false,
    interfaces: ['passive'],
    pins,
    render: { draw },
    catalog: {
      categoryId: 'breadboards',
      category: 'Breadboards',
      aliases: ['breadboard', 'protoboard', 'เบรดบอร์ด', size.model.toLowerCase()],
      tags: ['breadboard', 'prototyping', 'solderless', 'protoboard', 'jumper', 'rails'],
      interfaceLabel: `${columns} คอลัมน์ · ${pins.length} รู`,
      typicalUsage: 'Building and reworking circuits without soldering.',
    },
  };
}

export const BREADBOARD_FULL = createBreadboard({
  id: 'breadboard-full',
  name: 'Breadboard (full size)',
  model: 'BB-830 · 63 columns',
  columns: 63,
  powerRails: true,
});

export const BREADBOARD_HALF = createBreadboard({
  id: 'breadboard-half',
  name: 'Breadboard (half size)',
  model: 'BB-400 · 30 columns',
  columns: 30,
  powerRails: true,
});

export const BREADBOARD_MINI = createBreadboard({
  id: 'breadboard-mini',
  name: 'Breadboard (mini)',
  model: 'BB-170 · 17 columns',
  columns: 17,
  powerRails: false,
});

/**
 * Bonds every hole that shares a strip or a rail.
 *
 * Without this a breadboard is only a picture: parts plugged into the same
 * column would sit on separate nets and no current would flow. Grouping first
 * and bonding each group to its representative keeps this linear in hole count,
 * which matters because a full-size board carries 800+ holes.
 */
function createBreadboardBehavior(device: VirtualDevice): DeviceBehavior {
  const groups = new Map<string, string[]>();
  for (const boardPin of device.pins) {
    const node = breadboardNode(boardPin.name);
    const bucket = groups.get(node);
    if (bucket) bucket.push(boardPin.name);
    else groups.set(node, [boardPin.name]);
  }

  return {
    connect(context) {
      for (const names of groups.values()) {
        for (let index = 1; index < names.length; index++) {
          context.bond(names[0], names[index]);
        }
      }
    },
  };
}

for (const board of [BREADBOARD_FULL, BREADBOARD_HALF, BREADBOARD_MINI]) {
  board.simulation = () => createBreadboardBehavior(board);
}
