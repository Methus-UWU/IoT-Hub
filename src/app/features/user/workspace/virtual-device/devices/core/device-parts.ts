/**
 * Reusable sub-drawings shared across catalog parts.
 *
 * Consistency is the whole point: every board gets its pin headers, mounting
 * holes and ICs from here, so parts drawn months apart still look like one kit.
 * Anything drawn more than twice across the catalog belongs in this file.
 */

import { LED_COLORS, OUTLINE, PART, PCB, SILK, type LedColorName } from './device-palette';
import { circle, group, path, rect, repeat, text, type DetailLevel, type Shape } from './device-shape';

/** Standard 2.54 mm header pitch expressed in canvas units. */
export const PIN_PITCH = 19.5;

/** PCB body with a soft edge highlight instead of a heavy drop shadow. */
export function board(
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  options: { readonly rx?: number; readonly edge?: string } = {},
): readonly Shape[] {
  const rx = options.rx ?? 8;
  return [
    rect(x, y, width, height, {
      rx,
      fill,
      stroke: OUTLINE,
      strokeWidth: 1.5,
    }),
    // A single 1px inner line reads as board thickness without a gradient.
    rect(x + 2, y + 2, width - 4, height - 4, {
      rx: Math.max(rx - 2, 0),
      fill: 'none',
      stroke: options.edge ?? SILK.dim,
      strokeWidth: 1,
      opacity: 0.25,
      detail: 'normal',
    }),
  ];
}

/** Plated mounting hole. */
export function mountingHole(cx: number, cy: number, r = 6): Shape {
  return group(
    [
      circle(cx, cy, r, { fill: PART.solder, stroke: OUTLINE, strokeWidth: 1 }),
      circle(cx, cy, r * 0.55, { fill: '#0b0e12' }),
    ],
    { detail: 'normal' },
  );
}

/**
 * A row of female header sockets — the black plastic strip with gold-rimmed
 * holes that peripherals plug into.
 */
export function femaleHeader(
  x: number,
  y: number,
  count: number,
  orientation: 'horizontal' | 'vertical' = 'vertical',
  pitch = PIN_PITCH,
): readonly Shape[] {
  const vertical = orientation === 'vertical';
  const length = count * pitch;
  const thickness = pitch * 0.92;
  const bodyX = vertical ? x - thickness / 2 : x - pitch / 2;
  const bodyY = vertical ? y - pitch / 2 : y - thickness / 2;

  return [
    rect(bodyX, bodyY, vertical ? thickness : length, vertical ? length : thickness, {
      rx: 2,
      fill: PART.headerPlastic,
      stroke: OUTLINE,
      strokeWidth: 1,
    }),
    ...repeat(
      count,
      { x: vertical ? 0 : pitch, y: vertical ? pitch : 0 },
      (_, holeX, holeY) => [
        rect(holeX - 5.5, holeY - 5.5, 11, 11, {
          rx: 1.5,
          fill: PART.headerGoldDark,
          detail: 'normal',
        }),
        rect(holeX - 3.5, holeY - 3.5, 7, 7, { rx: 1, fill: '#0a0c0f', detail: 'normal' }),
      ],
      { x, y },
    ),
  ];
}

/** A row of male header pins — square gold posts on a black base. */
export function maleHeader(
  x: number,
  y: number,
  count: number,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
  pitch = PIN_PITCH,
): readonly Shape[] {
  const horizontal = orientation === 'horizontal';
  const length = count * pitch;
  const thickness = pitch * 0.8;

  return [
    rect(
      horizontal ? x - pitch / 2 : x - thickness / 2,
      horizontal ? y - thickness / 2 : y - pitch / 2,
      horizontal ? length : thickness,
      horizontal ? thickness : length,
      { rx: 2, fill: PART.headerPlastic, stroke: OUTLINE, strokeWidth: 1 },
    ),
    ...repeat(
      count,
      { x: horizontal ? pitch : 0, y: horizontal ? 0 : pitch },
      (_, pinX, pinY) =>
        rect(pinX - 3.5, pinY - 3.5, 7, 7, {
          rx: 1,
          fill: PART.headerGold,
          stroke: PART.headerGoldDark,
          strokeWidth: 0.75,
          detail: 'normal',
        }),
      { x, y },
    ),
  ];
}

/** Black DIP/QFN integrated circuit with a pin-1 dot and a part number. */
export function chip(
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  options: { readonly labelSize?: number; readonly fill?: string } = {},
): readonly Shape[] {
  return [
    rect(x, y, width, height, {
      rx: 3,
      fill: options.fill ?? PART.icBlack,
      stroke: OUTLINE,
      strokeWidth: 1,
    }),
    circle(x + 9, y + 9, 3, { fill: PART.icShine, detail: 'normal' }),
    text(x + width / 2, y + height / 2 + (options.labelSize ?? 11) * 0.35, label, {
      size: options.labelSize ?? 11,
      fill: SILK.soft,
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
  ];
}

/**
 * Through-hole DIP integrated circuit: a black body with two rows of silver legs
 * that emerge from under the long edges, a moulded half-circle notch at one end,
 * and a pin-1 dot. `pinsPerSide` legs run along each edge, so a DIP-28 passes 14.
 */
export function dipChip(
  x: number,
  y: number,
  width: number,
  height: number,
  pinsPerSide: number,
  label: string,
  options: { readonly labelSize?: number; readonly fill?: string } = {},
): readonly Shape[] {
  const pitch = width / pinsPerSide;
  const legWidth = Math.min(pitch * 0.5, 8);
  const legHeight = 9;
  const legInset = (pitch - legWidth) / 2;
  const notchR = height * 0.16;
  const centreY = y + height / 2;

  // Legs sit under the body: the 3-unit overlap is hidden once the body is
  // drawn on top, so each leg reads as emerging from beneath the package.
  const legs = repeat(
    pinsPerSide,
    { x: pitch },
    (_, legX) => [
      rect(legX + legInset, y - legHeight + 3, legWidth, legHeight, {
        rx: 1.5,
        fill: PART.metal,
        stroke: PART.metalDark,
        strokeWidth: 0.75,
        detail: 'normal',
      }),
      rect(legX + legInset, y + height - 3, legWidth, legHeight, {
        rx: 1.5,
        fill: PART.metal,
        stroke: PART.metalDark,
        strokeWidth: 0.75,
        detail: 'normal',
      }),
    ],
    { x },
  );

  return [
    ...legs,
    rect(x, y, width, height, {
      rx: 4,
      fill: options.fill ?? PART.icBlack,
      stroke: OUTLINE,
      strokeWidth: 1,
    }),
    path(`M ${x} ${centreY - notchR} A ${notchR} ${notchR} 0 0 1 ${x} ${centreY + notchR} Z`, {
      fill: PART.icShine,
      detail: 'normal',
    }),
    circle(x + 13, y + 13, 3, { fill: PART.icShine, detail: 'normal' }),
    text(x + width / 2, y + height / 2 + (options.labelSize ?? 11) * 0.35, label, {
      size: options.labelSize ?? 11,
      fill: SILK.soft,
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
  ];
}

/** Surface-mount indicator LED, lit or dark. */
export function indicatorLed(
  cx: number,
  cy: number,
  color: LedColorName,
  on: boolean,
  r = 5,
): readonly Shape[] {
  const tone = LED_COLORS[color];
  const shapes: Shape[] = [];
  // Glow stays subtle and only exists while lit, so a dark board never looks hazy.
  if (on) shapes.push(circle(cx, cy, r * 2.1, { fill: tone.glow, opacity: 0.28 }));
  shapes.push(
    circle(cx, cy, r, {
      fill: on ? tone.on : tone.off,
      stroke: OUTLINE,
      strokeWidth: 0.75,
    }),
  );
  return shapes;
}

/** Silkscreen part label. */
export function silkLabel(
  x: number,
  y: number,
  content: string,
  options: {
    readonly size?: number;
    readonly anchor?: 'start' | 'middle' | 'end';
    readonly fill?: string;
    readonly rotate?: number;
    readonly weight?: number;
    readonly detail?: DetailLevel;
  } = {},
): Shape {
  return text(x, y, content, {
    size: options.size ?? 11,
    fill: options.fill ?? SILK.white,
    anchor: options.anchor ?? 'middle',
    weight: options.weight ?? 600,
    rotate: options.rotate,
    detail: options.detail,
    mono: true,
  });
}

/**
 * Pin name printed next to a header hole. Small but never below 9 units, which
 * is the point where labels stop being legible at 100 % zoom.
 */
export function pinLabel(
  x: number,
  y: number,
  content: string,
  anchor: 'start' | 'middle' | 'end' = 'start',
  rotate?: number,
  // Dense pinouts (ESP-class boards, breadboards) default to `high` so the
  // interactive canvas overlay discloses them instead of dozens of permanent
  // labels covering the artwork. Boards that print their pinout on the silk
  // (an Uno) pass `normal` so the names stay visible at working zoom.
  detail: DetailLevel = 'high',
  // Boards with a tight header-to-body gap can shrink the label so long names
  // (RESET, IOREF) clear the pin hole instead of printing over it.
  size = 9.5,
): Shape {
  return text(x, y, content, {
    size,
    fill: SILK.soft,
    anchor,
    weight: 500,
    mono: true,
    rotate,
    detail,
  });
}

/** USB connector shell, drawn as a metal can hanging off a board edge. */
export function usbConnector(
  x: number,
  y: number,
  width: number,
  height: number,
  variant: 'micro' | 'type-c' | 'type-b' = 'micro',
): readonly Shape[] {
  const inset = variant === 'type-b' ? 6 : 4;
  return [
    rect(x, y, width, height, {
      rx: variant === 'type-c' ? height / 2 : 3,
      fill: PART.metal,
      stroke: PART.metalDark,
      strokeWidth: 1.25,
    }),
    rect(x + inset, y + inset, Math.max(width - inset * 2, 2), Math.max(height - inset * 2, 2), {
      rx: variant === 'type-c' ? (height - inset * 2) / 2 : 2,
      fill: '#4a5058',
      detail: 'normal',
    }),
  ];
}

/** Tactile reset button: metal cap on a dark base. */
export function tactileButton(
  cx: number,
  cy: number,
  size = 22,
  pressed = false,
): readonly Shape[] {
  const half = size / 2;
  return [
    rect(cx - half, cy - half, size, size, {
      rx: 2,
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: 1,
    }),
    circle(cx, cy, half * 0.62, {
      fill: pressed ? PART.metalDark : PART.metalLight,
      stroke: PART.metalDark,
      strokeWidth: 1,
    }),
  ];
}

/** PCB trace antenna, the zig-zag printed on wireless modules. */
export function pcbAntenna(x: number, y: number, width: number, height: number): Shape {
  const steps = 6;
  const stepWidth = width / steps;
  let d = `M ${x} ${y + height}`;
  for (let index = 0; index < steps; index++) {
    const left = x + index * stepWidth;
    d += ` L ${left} ${y} L ${left + stepWidth / 2} ${y} L ${left + stepWidth / 2} ${y + height} L ${
      left + stepWidth
    } ${y + height}`;
  }
  return group(
    [
      {
        kind: 'path',
        d,
        fill: 'none',
        stroke: PCB.white,
        strokeWidth: 3,
        strokeLinejoin: 'miter',
      },
    ],
    { detail: 'normal' },
  );
}

/** Electrolytic capacitor seen from above. */
export function electrolyticCap(cx: number, cy: number, r: number): readonly Shape[] {
  return [
    circle(cx, cy, r, { fill: PART.electrolytic, stroke: OUTLINE, strokeWidth: 1 }),
    circle(cx, cy, r * 0.66, { fill: '#1e2a3f', detail: 'normal' }),
    text(cx, cy + r * 0.3, '−', {
      size: r,
      fill: SILK.soft,
      anchor: 'middle',
      weight: 700,
      detail: 'normal',
    }),
  ];
}
