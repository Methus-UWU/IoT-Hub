/**
 * Orthogonal wire routing.
 *
 * Straight point-to-point lines cut through components and cross each other at
 * arbitrary angles, which is what makes a dense diagram unreadable. This router
 * produces Manhattan paths instead: a short stub out of each pin along the side
 * it belongs to, then axis-aligned segments to the target, steered around
 * component bounding boxes where a detour is cheap.
 *
 * Everything here is a pure function of its inputs. That keeps it testable
 * without a canvas, and means a routing change applies to every saved project
 * because paths are computed at render time rather than stored.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type PinSide = 'left' | 'right' | 'top' | 'bottom';

export interface RouteEndpoint {
  readonly point: Point;
  /** Which edge of its component the pin sits on; decides the exit direction. */
  readonly side?: PinSide;
}

export interface Obstacle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How far a wire leaves a pin before it is allowed to turn. */
const STUB = 18;

/** Clearance kept around a component when routing past it. */
const MARGIN = 14;

function directionFor(side: PinSide | undefined, fallback: Point, target: Point): Point {
  switch (side) {
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    default:
      // No declared side: leave along whichever axis has more distance to cover,
      // which is the direction the wire has to travel anyway.
      return Math.abs(target.x - fallback.x) >= Math.abs(target.y - fallback.y)
        ? { x: Math.sign(target.x - fallback.x) || 1, y: 0 }
        : { x: 0, y: Math.sign(target.y - fallback.y) || 1 };
  }
}

function offset(point: Point, direction: Point, distance: number): Point {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
}

function expand(box: Obstacle, margin: number): Obstacle {
  return {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + margin * 2,
    height: box.height + margin * 2,
  };
}

function contains(box: Obstacle, point: Point): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** True when an axis-aligned segment passes through the box. */
function segmentHitsBox(from: Point, to: Point, box: Obstacle): boolean {
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);

  return (
    maxX >= box.x &&
    minX <= box.x + box.width &&
    maxY >= box.y &&
    minY <= box.y + box.height
  );
}

function pathHitsAny(points: readonly Point[], boxes: readonly Obstacle[]): boolean {
  for (let index = 0; index < points.length - 1; index++) {
    for (const box of boxes) {
      if (segmentHitsBox(points[index], points[index + 1], box)) return true;
    }
  }
  return false;
}

/** Removes points that lie on a straight line between their neighbours. */
function simplify(points: readonly Point[]): Point[] {
  const result: Point[] = [];

  for (const point of points) {
    const last = result[result.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    result.push(point);
  }

  for (let index = 1; index < result.length - 1; ) {
    const previous = result[index - 1];
    const current = result[index];
    const next = result[index + 1];

    // A point is redundant only when the path passes straight *through* it.
    // Three points can share a coordinate while the path doubles back — a pin
    // that must exit upward before descending, for example — and dropping the
    // middle one there would erase the stub and send the wire straight through
    // whatever the detour existed to avoid.
    const onVertical = previous.x === current.x && current.x === next.x;
    const onHorizontal = previous.y === current.y && current.y === next.y;
    const passesThrough = onVertical
      ? (current.y - previous.y) * (next.y - current.y) > 0
      : onHorizontal
        ? (current.x - previous.x) * (next.x - current.x) > 0
        : false;

    if (passesThrough) result.splice(index, 1);
    else index++;
  }

  return result;
}

/**
 * Candidate elbows between two stub ends.
 *
 * Horizontal-first and vertical-first are the two natural L shapes; the two
 * mid-line routes are the Z shapes used when an L would clip something.
 */
function candidates(from: Point, to: Point): Point[][] {
  const midX = Math.round((from.x + to.x) / 2);
  const midY = Math.round((from.y + to.y) / 2);

  return [
    [from, { x: to.x, y: from.y }, to],
    [from, { x: from.x, y: to.y }, to],
    [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to],
    [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to],
  ];
}

/**
 * Routes one wire.
 *
 * `manualWaypoints` wins where present: a user who has placed bends has said
 * what they want, and the router must not argue with it. Automatic routing only
 * fills the gaps between the pins and those bends.
 */
export function routeWire(
  start: RouteEndpoint,
  end: RouteEndpoint,
  obstacles: readonly Obstacle[] = [],
  manualWaypoints: readonly Point[] = [],
): Point[] {
  const startDirection = directionFor(start.side, start.point, end.point);
  const endDirection = directionFor(end.side, end.point, start.point);
  const startStub = offset(start.point, startDirection, STUB);
  const endStub = offset(end.point, endDirection, STUB);

  if (manualWaypoints.length > 0) {
    return simplify([
      start.point,
      startStub,
      ...manualWaypoints,
      endStub,
      end.point,
    ]);
  }

  // Ignore boxes that contain a pin: a wire must be allowed to leave the
  // component it is attached to.
  const padded = obstacles
    .map((box) => expand(box, MARGIN))
    .filter((box) => !contains(box, start.point) && !contains(box, end.point));

  let best: Point[] | null = null;
  for (const elbow of candidates(startStub, endStub)) {
    const full = simplify([start.point, ...elbow, end.point]);
    if (!pathHitsAny(full, padded)) return full;
    // Remember the first candidate so a fully blocked route still returns a
    // readable orthogonal path rather than nothing.
    best ??= full;
  }

  return best ?? simplify([start.point, startStub, endStub, end.point]);
}

/**
 * Renders a routed path with rounded corners.
 *
 * The radius shrinks to fit short segments, so a tight elbow bends rather than
 * overshooting into the next segment.
 */
export function orthogonalPath(points: readonly Point[], radius = 8): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];

    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const bend = Math.min(radius, inLength / 2, outLength / 2);

    if (bend <= 0.5) {
      path += ` L ${corner.x} ${corner.y}`;
      continue;
    }

    const enter = {
      x: corner.x - ((corner.x - previous.x) / inLength) * bend,
      y: corner.y - ((corner.y - previous.y) / inLength) * bend,
    };
    const exit = {
      x: corner.x + ((next.x - corner.x) / outLength) * bend,
      y: corner.y + ((next.y - corner.y) / outLength) * bend,
    };

    path += ` L ${round(enter.x)} ${round(enter.y)}`;
    path += ` Q ${corner.x} ${corner.y} ${round(exit.x)} ${round(exit.y)}`;
  }

  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
