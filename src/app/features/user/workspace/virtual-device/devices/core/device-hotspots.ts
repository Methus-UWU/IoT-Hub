/**
 * Parts you can operate by clicking their artwork.
 *
 * A tactile switch has a cap; a relay module has a channel per block. Both were
 * previously wired into the canvas template by device id — `device.id ===
 * 'button'` beside a hard-coded cap position, and a relay-only loop beside it —
 * which meant every new operable part required editing the canvas.
 *
 * A hotspot instead declares *where* it is and *which property* it drives, in
 * the part's own coordinate system. The canvas renders whatever the part lists
 * and knows nothing about what the part is.
 */

export type HotspotRegion =
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx?: number;
    }
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number };

export interface DeviceHotspot {
  readonly id: string;
  /** Announced to assistive technology, so it must name the action. */
  readonly label: string;
  readonly region: HotspotRegion;
  /** Property this hotspot drives; it must exist on the part. */
  readonly property: string;
  /**
   * `momentary` follows the pointer — true on press, false on release, like a
   * real push button. `toggle` flips on each activation and stays there. Both
   * drive a boolean.
   *
   * `rotary` is a shaft you turn: dragging sets the property from the pointer's
   * angle about the region's centre, so the value it writes is a number.
   */
  readonly mode: 'momentary' | 'toggle' | 'rotary';
  /**
   * `rotary` only: how far the shaft turns each side of its centre position, in
   * degrees. A single-turn potentiometer stops at ±135°.
   */
  readonly sweep?: number;
  /** `rotary` only: the numeric range that full travel spans. */
  readonly range?: { readonly min: number; readonly max: number };
}

export function circleHotspot(
  id: string,
  label: string,
  property: string,
  cx: number,
  cy: number,
  r: number,
  mode: DeviceHotspot['mode'] = 'momentary',
): DeviceHotspot {
  return { id, label, property, mode, region: { kind: 'circle', cx, cy, r } };
}

/**
 * A shaft the user turns. The region is the grip the pointer drags — a knob's
 * cap — and its centre is the axis every drag angle is measured about.
 */
export function rotaryHotspot(
  id: string,
  label: string,
  property: string,
  cx: number,
  cy: number,
  r: number,
  options: { sweep?: number; range?: { min: number; max: number } } = {},
): DeviceHotspot {
  return {
    id,
    label,
    property,
    mode: 'rotary',
    region: { kind: 'circle', cx, cy, r },
    sweep: options.sweep ?? 135,
    range: options.range ?? { min: 0, max: 100 },
  };
}

export function rectHotspot(
  id: string,
  label: string,
  property: string,
  box: { x: number; y: number; width: number; height: number; rx?: number },
  mode: DeviceHotspot['mode'] = 'toggle',
): DeviceHotspot {
  return { id, label, property, mode, region: { kind: 'rect', ...box } };
}
