import type { DeviceKind } from '../../workspace/virtual-device/device-library.models';
import { deviceById } from '../../workspace/virtual-device/devices/device-catalog';
import { PART, PCB } from '../../workspace/virtual-device/devices/core/device-palette';

/**
 * Teaching diagrams built from catalog artwork. Wire endpoints are resolved from
 * the catalog pins, so a diagram can never point at a pin the part does not have;
 * only the part placement and the orthogonal route of each wire are authored.
 */

export type Point = readonly [number, number];

/** Wire colours shared by every example: red power, black ground, blue/orange signal. */
export const WIRE = {
  power: PART.wireRed,
  ground: PART.wireBlack,
  signal: PCB.blue,
  signalAlt: PART.wireOrange,
} as const;

export interface PartSpec {
  readonly device: DeviceKind;
  readonly label: string;
  readonly at: Point;
  readonly scale: number;
  /** Quarter turns clockwise. The label stays upright. */
  readonly rotate?: 0 | 90;
  readonly state?: Readonly<Record<string, unknown>>;
  /** Label position relative to `at`; defaults to just above the part. */
  readonly labelAt?: Point;
}

type Endpoint = readonly [partIndex: number, pinName: string];

/**
 * An orthogonal route: the first axis to move along, then the coordinates to
 * stop at, alternating axes. The last leg to the end pin is added automatically.
 * `['h', 410]` means: go horizontally to x = 410, then vertically and
 * horizontally to the end pin.
 */
export type Route = readonly ['h' | 'v', ...number[]];

export interface WireSpec {
  readonly label: string;
  readonly from: Endpoint;
  readonly to: Endpoint;
  readonly color: string;
  readonly route?: Route;
  /** Number badge position; defaults to the middle of the longest leg. */
  readonly badge?: Point;
}

export interface DiagramNote {
  readonly at: Point;
  readonly text: string;
}

export interface WiringExampleSpec {
  readonly id: string;
  /** Short name for the example picker. */
  readonly name: string;
  readonly title: string;
  /** Text alternative for the whole diagram. */
  readonly description: string;
  readonly size: Point;
  readonly parts: readonly PartSpec[];
  readonly wires: readonly WireSpec[];
  readonly notes?: readonly DiagramNote[];
  readonly materials: string;
  readonly tips: readonly string[];
}

export function buildWiringExample(spec: WiringExampleSpec) {
  const parts = spec.parts.map((part) => {
    const device = deviceById(part.device);
    if (!device) throw new Error(`Unknown guide device: ${part.device}`);
    const [x, y] = part.at;
    const rotate = part.rotate ?? 0;
    const [labelX, labelY] = part.labelAt ?? [0, -18];
    return {
      key: `${part.device}@${x},${y}`,
      device,
      label: part.label,
      labelX: x + labelX,
      labelY: y + labelY,
      state: part.state ?? {},
      scale: part.scale,
      rotate,
      origin: part.at,
      transform: `translate(${x} ${y}) rotate(${rotate}) scale(${part.scale})`,
    };
  });

  const endpoint = ([partIndex, pinName]: Endpoint): Point => {
    const part = parts[partIndex];
    const pin = part.device.pins.find((candidate) => candidate.name === pinName);
    if (!pin) throw new Error(`Unknown guide pin: ${part.device.id}/${pinName}`);
    const [x, y] = part.origin;
    const px = pin.x * part.scale;
    const py = pin.y * part.scale;
    return part.rotate === 90 ? [x - py, y + px] : [x + px, y + py];
  };

  const wires = spec.wires.map((wire, index) => {
    const start = endpoint(wire.from);
    const end = endpoint(wire.to);
    const points = routePoints(start, end, wire.route ?? ['h']);
    return {
      id: index + 1,
      label: wire.label,
      color: wire.color,
      start,
      end,
      badge: wire.badge ?? longestLegMiddle(points),
      path: points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' '),
    };
  });

  return { ...spec, parts, wires, viewBox: `0 0 ${spec.size[0]} ${spec.size[1]}` };
}

export type WiringExample = ReturnType<typeof buildWiringExample>;

function routePoints(start: Point, end: Point, [firstAxis, ...stops]: Route): Point[] {
  const points: Point[] = [start];
  let axis = firstAxis;
  let [x, y] = start;
  for (const stop of stops) {
    if (axis === 'h') x = stop;
    else y = stop;
    points.push([x, y]);
    axis = axis === 'h' ? 'v' : 'h';
  }
  points.push(axis === 'v' ? [x, end[1]] : [end[0], y], end);
  return points.filter(
    (point, i) => i === 0 || point[0] !== points[i - 1][0] || point[1] !== points[i - 1][1],
  );
}

function longestLegMiddle(points: readonly Point[]): Point {
  let best: Point = points[0];
  let bestLength = -1;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const length = Math.abs(bx - ax) + Math.abs(by - ay);
    if (length > bestLength) {
      bestLength = length;
      best = [(ax + bx) / 2, (ay + by) / 2];
    }
  }
  return best;
}
