/**
 * A tiny declarative drawing language for device artwork.
 *
 * Every part describes itself as a flat list of primitives instead of shipping
 * its own Angular component. One generic renderer then draws that list, which
 * is what lets the canvas, the placement ghost, the library thumbnail and the
 * inspector preview share a single source of artwork with zero duplication —
 * and keeps ~300 catalog parts from becoming ~300 components in the bundle.
 *
 * Shapes are plain data, so a part's drawing can be unit tested without a DOM.
 */

/** How much fine detail to draw. Thumbnails drop the small stuff. */
export type DetailLevel = 'low' | 'normal' | 'high';

export interface ShapeBase {
  /**
   * The coarsest level at which this shape appears. Omitting it means "always
   * draw", which is what body outlines and defining features want; mark the
   * fine stuff `normal` or `high` so thumbnails shed it.
   */
  readonly detail?: DetailLevel;
  readonly opacity?: number;
}

export interface RectShape extends ShapeBase {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx?: number;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
}

export interface CircleShape extends ShapeBase {
  readonly kind: 'circle';
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
}

export interface EllipseShape extends ShapeBase {
  readonly kind: 'ellipse';
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
}

export interface PathShape extends ShapeBase {
  readonly kind: 'path';
  readonly d: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly strokeLinecap?: 'butt' | 'round' | 'square';
  readonly strokeLinejoin?: 'miter' | 'round' | 'bevel';
}

export interface LineShape extends ShapeBase {
  readonly kind: 'line';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly strokeLinecap?: 'butt' | 'round' | 'square';
}

export interface TextShape extends ShapeBase {
  readonly kind: 'text';
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly size?: number;
  readonly fill?: string;
  readonly anchor?: 'start' | 'middle' | 'end';
  readonly weight?: number | 'normal' | 'bold';
  readonly letterSpacing?: number;
  /** Degrees, rotated about (x, y). Used for vertical silkscreen. */
  readonly rotate?: number;
  readonly mono?: boolean;
}

export interface GroupShape extends ShapeBase {
  readonly kind: 'group';
  readonly children: readonly Shape[];
  readonly transform?: string;
}

export type Shape =
  | RectShape
  | CircleShape
  | EllipseShape
  | PathShape
  | LineShape
  | TextShape
  | GroupShape;

const DETAIL_RANK: Readonly<Record<DetailLevel, number>> = { low: 0, normal: 1, high: 2 };

/**
 * Drops shapes that are finer than the requested detail level, recursing into
 * groups. A thumbnail asks for `low` and gets only the silhouette-defining
 * shapes; the canvas asks for `normal`; zoomed-in rendering asks for `high`.
 *
 * Unmarked shapes default to `low`, so a part always keeps its body no matter
 * how far the detail budget is cut.
 */
export function shapesForDetail(shapes: readonly Shape[], detail: DetailLevel): readonly Shape[] {
  const budget = DETAIL_RANK[detail];
  const result: Shape[] = [];

  for (const shape of shapes) {
    if (DETAIL_RANK[shape.detail ?? 'low'] > budget) continue;
    if (shape.kind === 'group') {
      result.push({ ...shape, children: shapesForDetail(shape.children, detail) });
    } else {
      result.push(shape);
    }
  }

  return result;
}

// ------------------------------------------------------------------ builders
// Terse helpers so a device file reads like a drawing, not like a data dump.

export function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  options: Omit<RectShape, 'kind' | 'x' | 'y' | 'width' | 'height'> = {},
): RectShape {
  return { kind: 'rect', x, y, width, height, ...options };
}

export function circle(
  cx: number,
  cy: number,
  r: number,
  options: Omit<CircleShape, 'kind' | 'cx' | 'cy' | 'r'> = {},
): CircleShape {
  return { kind: 'circle', cx, cy, r, ...options };
}

export function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  options: Omit<EllipseShape, 'kind' | 'cx' | 'cy' | 'rx' | 'ry'> = {},
): EllipseShape {
  return { kind: 'ellipse', cx, cy, rx, ry, ...options };
}

export function path(d: string, options: Omit<PathShape, 'kind' | 'd'> = {}): PathShape {
  return { kind: 'path', d, ...options };
}

export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  options: Omit<LineShape, 'kind' | 'x1' | 'y1' | 'x2' | 'y2'> = {},
): LineShape {
  return { kind: 'line', x1, y1, x2, y2, ...options };
}

export function text(
  x: number,
  y: number,
  content: string,
  options: Omit<TextShape, 'kind' | 'x' | 'y' | 'text'> = {},
): TextShape {
  return { kind: 'text', x, y, text: content, ...options };
}

export function group(
  children: readonly Shape[],
  options: Omit<GroupShape, 'kind' | 'children'> = {},
): GroupShape {
  return { kind: 'group', children, ...options };
}

/** Repeats a drawing along a line — pin headers, LED bars, breadboard holes. */
export function repeat(
  count: number,
  step: { x?: number; y?: number },
  draw: (index: number, x: number, y: number) => Shape | readonly Shape[] | null,
  origin: { x?: number; y?: number } = {},
): readonly Shape[] {
  const shapes: Shape[] = [];
  for (let index = 0; index < count; index++) {
    const x = (origin.x ?? 0) + index * (step.x ?? 0);
    const y = (origin.y ?? 0) + index * (step.y ?? 0);
    const drawn = draw(index, x, y);
    if (!drawn) continue;
    if (Array.isArray(drawn)) shapes.push(...drawn);
    else shapes.push(drawn as Shape);
  }
  return shapes;
}
