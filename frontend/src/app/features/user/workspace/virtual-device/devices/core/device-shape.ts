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

// -------------------------------------------------------------------- paints
// A fill or stroke is either a plain CSS colour or a gradient. Gradients are
// what separate "a grey rectangle" from "a stamped metal shield can": real
// hardware is lit from somewhere, and a single flat fill can never say that.
//
// A gradient is *data*, not a `<defs>` id, so a part stays pure and printable.
// The renderer hashes each gradient into a stable id and emits one `<defs>`
// entry per distinct gradient, which is why two boards using the same gold
// header share one definition instead of one per pin.

export interface GradientStop {
  /** 0..1 along the gradient axis. */
  readonly offset: number;
  readonly color: string;
  readonly opacity?: number;
}

export interface LinearGradientPaint {
  readonly kind: 'linear';
  /**
   * Direction in degrees: 0 points left→right, 90 points top→bottom. Defaults
   * to 90, which is the overhead lighting nearly every part wants.
   */
  readonly angle?: number;
  readonly stops: readonly GradientStop[];
}

export interface RadialGradientPaint {
  readonly kind: 'radial';
  /** Centre and radius as fractions of the shape's bounding box. */
  readonly cx?: number;
  readonly cy?: number;
  readonly r?: number;
  readonly stops: readonly GradientStop[];
}

export type GradientPaint = LinearGradientPaint | RadialGradientPaint;
export type Paint = string | GradientPaint;

export function isGradient(paint: Paint | undefined): paint is GradientPaint {
  return typeof paint === 'object' && paint !== null;
}

/** Two stops along the given angle — the shading almost every surface needs. */
export function linear(
  from: string,
  to: string,
  angle = 90,
  stops?: readonly GradientStop[],
): LinearGradientPaint {
  return {
    kind: 'linear',
    angle,
    stops: stops ?? [
      { offset: 0, color: from },
      { offset: 1, color: to },
    ],
  };
}

/** A highlight blooming from one point — domes, lenses, lit LEDs, buttons. */
export function radial(
  stops: readonly GradientStop[],
  options: { readonly cx?: number; readonly cy?: number; readonly r?: number } = {},
): RadialGradientPaint {
  return { kind: 'radial', stops, ...options };
}

/**
 * A stable id for a gradient, derived from its own definition.
 *
 * Deriving rather than counting matters: the same gradient reached through two
 * different parts must produce the same id, otherwise every placed component
 * would add its own copy of every `<defs>` entry it uses. Two documents that
 * both define the id define it identically, so a duplicate is harmless.
 */
export function paintId(paint: GradientPaint): string {
  const signature =
    paint.kind === 'linear'
      ? `l${paint.angle ?? 90}`
      : `r${paint.cx ?? 0.5},${paint.cy ?? 0.5},${paint.r ?? 0.5}`;
  const body = paint.stops
    .map((stop) => `${stop.offset}:${stop.color}:${stop.opacity ?? 1}`)
    .join('|');
  return `dg${hash(`${signature}#${body}`)}`;
}

/** FNV-1a, base36. Short, stable, and collision-free enough for a palette. */
function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(36);
}

/** The `fill`/`stroke` attribute value for a paint. */
export function paintRef(paint: Paint | undefined, fallback: string | null): string | null {
  if (paint === undefined) return fallback;
  return isGradient(paint) ? `url(#${paintId(paint)})` : paint;
}

/**
 * Every distinct gradient in a shape tree, de-duplicated by id.
 *
 * The renderer calls this once per artwork and emits the result as `<defs>`.
 */
export function collectGradients(shapes: readonly Shape[]): readonly GradientPaint[] {
  const found = new Map<string, GradientPaint>();

  const visit = (list: readonly Shape[]): void => {
    for (const shape of list) {
      if (shape.kind === 'group') {
        visit(shape.children);
        continue;
      }
      for (const paint of [
        (shape as { fill?: Paint }).fill,
        (shape as { stroke?: Paint }).stroke,
      ]) {
        if (isGradient(paint)) found.set(paintId(paint), paint);
      }
    }
  };

  visit(shapes);
  return [...found.values()];
}

/**
 * Gradient axis endpoints in `objectBoundingBox` units.
 *
 * Expressed as x1/y1/x2/y2 rather than `gradientTransform` so the definition
 * survives being scaled by the canvas zoom without skewing.
 */
export function linearAxis(angle: number): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians) / 2;
  const dy = Math.sin(radians) / 2;
  return {
    x1: round4(0.5 - dx),
    y1: round4(0.5 - dy),
    x2: round4(0.5 + dx),
    y2: round4(0.5 + dy),
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

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
  readonly fill?: Paint;
  readonly stroke?: Paint;
  readonly strokeWidth?: number;
}

export interface CircleShape extends ShapeBase {
  readonly kind: 'circle';
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fill?: Paint;
  readonly stroke?: Paint;
  readonly strokeWidth?: number;
}

export interface EllipseShape extends ShapeBase {
  readonly kind: 'ellipse';
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly fill?: Paint;
  readonly stroke?: Paint;
  readonly strokeWidth?: number;
}

export interface PathShape extends ShapeBase {
  readonly kind: 'path';
  readonly d: string;
  readonly fill?: Paint;
  readonly stroke?: Paint;
  readonly strokeWidth?: number;
  /** `evenodd` allows one path to cut real transparent holes from a surface. */
  readonly fillRule?: 'nonzero' | 'evenodd';
  readonly strokeLinecap?: 'butt' | 'round' | 'square';
  readonly strokeLinejoin?: 'miter' | 'round' | 'bevel';
}

export interface LineShape extends ShapeBase {
  readonly kind: 'line';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stroke?: Paint;
  readonly strokeWidth?: number;
  readonly strokeLinecap?: 'butt' | 'round' | 'square';
}

export interface TextShape extends ShapeBase {
  readonly kind: 'text';
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly size?: number;
  readonly fill?: Paint;
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
  RectShape | CircleShape | EllipseShape | PathShape | LineShape | TextShape | GroupShape;

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
