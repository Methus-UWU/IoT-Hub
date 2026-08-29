/**
 * Physical sizing for catalog parts.
 *
 * Every part used to pick its own drawing size, so an SG90 servo (23 mm) was
 * drawn the same size as an HC-SR04 (45 mm) and an ESP32 sat at a third scale
 * again. Nothing tied a drawing to the object it depicts.
 *
 * The fix is one authority: a part declares its real dimensions in millimetres,
 * and everything on the canvas is rendered at `PIXELS_PER_MM`. A part keeps
 * authoring its artwork in whatever units suit it — a header pitch, a pixel
 * grid — and this module works out the single factor that maps those units onto
 * the shared physical scale.
 *
 *     millimetres  →  device drawing units  →  canvas pixels
 *
 * That factor is applied to the artwork **and** to pin coordinates together.
 * Applying it to only one would drift the visible pin away from the point a wire
 * attaches to, which is the failure this system exists to make impossible.
 */

import type { VirtualDevice } from '../../models/virtual-device.model';

/**
 * Canvas pixels per millimetre at 100% zoom.
 *
 * Chosen so an ESP32 DevKit V1 — 28.3 mm across, the narrowest board that must
 * still print readable pin labels — lands near 230 px wide, matching the size
 * the canvas was already tuned around. Raising this magnifies every part
 * equally; it never changes their relative sizes.
 */
export const PIXELS_PER_MM = 8;

export interface PhysicalSize {
  readonly widthMm: number;
  readonly heightMm: number;
}

/** Converts a millimetre measurement to canvas pixels. */
export function mm(millimetres: number): number {
  return millimetres * PIXELS_PER_MM;
}

/**
 * How much a part's drawing units must be scaled to reach physical size.
 *
 * Returns 1 for a part that has not declared its dimensions yet, so migrating
 * the catalog is one part at a time rather than one breaking change.
 */
export function drawingScaleFor(
  device: Pick<VirtualDevice, 'width' | 'physicalSize'>,
): number {
  const physical = device.physicalSize;
  if (!physical || device.width <= 0 || physical.widthMm <= 0) return 1;

  return mm(physical.widthMm) / device.width;
}

/** The part's footprint on the canvas, in pixels, at 100% zoom. */
export function renderedSize(
  device: Pick<VirtualDevice, 'width' | 'height' | 'physicalSize'>,
): { width: number; height: number } {
  const scale = drawingScaleFor(device);
  return { width: device.width * scale, height: device.height * scale };
}

/**
 * True when the declared millimetres and the drawn units disagree about shape.
 *
 * A part whose artwork is 2:1 while its real body is 1:1 would be rendered
 * stretched, because a single scalar cannot fix a wrong aspect ratio. Used by
 * tests to catch that at authoring time rather than on screen.
 */
export function aspectRatioMismatch(
  device: Pick<VirtualDevice, 'width' | 'height' | 'physicalSize'>,
): number {
  const physical = device.physicalSize;
  if (!physical || device.height <= 0 || physical.heightMm <= 0) return 0;

  const drawnRatio = device.width / device.height;
  const physicalRatio = physical.widthMm / physical.heightMm;
  return Math.abs(drawnRatio - physicalRatio) / physicalRatio;
}
