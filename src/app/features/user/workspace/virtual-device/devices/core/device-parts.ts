/**
 * Reusable sub-drawings shared across catalog parts.
 *
 * Consistency is the whole point: every board gets its pin headers, mounting
 * holes and ICs from here, so parts drawn months apart still look like one kit.
 * Anything drawn more than twice across the catalog belongs in this file.
 *
 * Every dimension below is expressed through `u(millimetres)`. That is what
 * makes a header drawn on a 20 mm sensor and a header drawn on a 50 mm board
 * come out the same physical size — impossible while each part invented its own
 * units.
 */

import { HEADER_PITCH, u } from './device-metrics';
import { LED_COLORS, OUTLINE, PART, PCB, SILK, type LedColorName } from './device-palette';
import { circle, group, path, rect, repeat, text, type DetailLevel, type Shape } from './device-shape';

/** Standard 2.54 mm header pitch, in drawing units. */
export const PIN_PITCH = HEADER_PITCH;

/** PCB body with a soft edge highlight instead of a heavy drop shadow. */
export function board(
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  options: { readonly rx?: number; readonly edge?: string } = {},
): readonly Shape[] {
  const rx = options.rx ?? u(1);
  return [
    rect(x, y, width, height, {
      rx,
      fill,
      stroke: OUTLINE,
      strokeWidth: u(0.15),
    }),
    // A single hairline inside the edge reads as board thickness without a gradient.
    rect(x + u(0.25), y + u(0.25), width - u(0.5), height - u(0.5), {
      rx: Math.max(rx - u(0.25), 0),
      fill: 'none',
      stroke: options.edge ?? SILK.dim,
      strokeWidth: u(0.1),
      opacity: 0.25,
      detail: 'normal',
    }),
  ];
}

/** Plated mounting hole. M3 clearance unless a part asks for something else. */
export function mountingHole(cx: number, cy: number, r = u(1.7)): Shape {
  return group(
    [
      circle(cx, cy, r, { fill: PART.solder, stroke: OUTLINE, strokeWidth: u(0.1) }),
      circle(cx, cy, r * 0.62, { fill: '#0b0e12' }),
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
  // A real 0.1 in socket strip measures 2.5 mm across the plastic.
  const thickness = u(2.5);
  const bodyX = vertical ? x - thickness / 2 : x - pitch / 2;
  const bodyY = vertical ? y - pitch / 2 : y - thickness / 2;
  const rim = u(0.9);
  const bore = u(0.55);

  return [
    rect(bodyX, bodyY, vertical ? thickness : length, vertical ? length : thickness, {
      rx: u(0.2),
      fill: PART.headerPlastic,
      stroke: OUTLINE,
      strokeWidth: u(0.1),
    }),
    ...repeat(
      count,
      { x: vertical ? 0 : pitch, y: vertical ? pitch : 0 },
      (_, holeX, holeY) => [
        rect(holeX - rim, holeY - rim, rim * 2, rim * 2, {
          rx: u(0.15),
          fill: PART.headerGoldDark,
          detail: 'normal',
        }),
        rect(holeX - bore, holeY - bore, bore * 2, bore * 2, {
          rx: u(0.1),
          fill: '#0a0c0f',
          detail: 'normal',
        }),
      ],
      { x, y },
    ),
  ];
}

/**
 * A row of male header pins — square gold posts on a black base.
 *
 * The post is drawn at 0.9 mm rather than the true 0.64 mm of the pin stock: at
 * working zoom the exact figure collapses to one dark pixel, and a pin the user
 * cannot see is a pin they cannot aim a wire at.
 */
export function maleHeader(
  x: number,
  y: number,
  count: number,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
  pitch = PIN_PITCH,
): readonly Shape[] {
  const horizontal = orientation === 'horizontal';
  const length = count * pitch;
  const thickness = u(2.5);
  const post = u(0.45);

  return [
    rect(
      horizontal ? x - pitch / 2 : x - thickness / 2,
      horizontal ? y - thickness / 2 : y - pitch / 2,
      horizontal ? length : thickness,
      horizontal ? thickness : length,
      { rx: u(0.2), fill: PART.headerPlastic, stroke: OUTLINE, strokeWidth: u(0.1) },
    ),
    ...repeat(
      count,
      { x: horizontal ? pitch : 0, y: horizontal ? 0 : pitch },
      (_, pinX, pinY) =>
        rect(pinX - post, pinY - post, post * 2, post * 2, {
          rx: u(0.1),
          fill: PART.headerGold,
          stroke: PART.headerGoldDark,
          strokeWidth: u(0.08),
          detail: 'normal',
        }),
      { x, y },
    ),
  ];
}

/** Black surface-mount integrated circuit with a pin-1 dot and a part number. */
export function chip(
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  options: { readonly labelSize?: number; readonly fill?: string } = {},
): readonly Shape[] {
  const labelSize = options.labelSize ?? u(1.1);
  return [
    rect(x, y, width, height, {
      rx: u(0.3),
      fill: options.fill ?? PART.icBlack,
      stroke: OUTLINE,
      strokeWidth: u(0.1),
    }),
    circle(x + u(0.9), y + u(0.9), u(0.3), { fill: PART.icShine, detail: 'normal' }),
    text(x + width / 2, y + height / 2 + labelSize * 0.35, label, {
      size: labelSize,
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
  const legWidth = Math.min(pitch * 0.5, u(0.8));
  const legHeight = u(1.1);
  const legInset = (pitch - legWidth) / 2;
  const notchR = height * 0.16;
  const centreY = y + height / 2;
  const labelSize = options.labelSize ?? u(1.1);
  // Legs overlap the body by this much so they read as emerging from beneath it.
  const tuck = u(0.35);

  const legs = repeat(
    pinsPerSide,
    { x: pitch },
    (_, legX) => [
      rect(legX + legInset, y - legHeight + tuck, legWidth, legHeight, {
        rx: u(0.15),
        fill: PART.metal,
        stroke: PART.metalDark,
        strokeWidth: u(0.08),
        detail: 'normal',
      }),
      rect(legX + legInset, y + height - tuck, legWidth, legHeight, {
        rx: u(0.15),
        fill: PART.metal,
        stroke: PART.metalDark,
        strokeWidth: u(0.08),
        detail: 'normal',
      }),
    ],
    { x },
  );

  return [
    ...legs,
    rect(x, y, width, height, {
      rx: u(0.4),
      fill: options.fill ?? PART.icBlack,
      stroke: OUTLINE,
      strokeWidth: u(0.1),
    }),
    path(`M ${x} ${centreY - notchR} A ${notchR} ${notchR} 0 0 1 ${x} ${centreY + notchR} Z`, {
      fill: PART.icShine,
      detail: 'normal',
    }),
    circle(x + u(1.3), y + u(1.3), u(0.3), { fill: PART.icShine, detail: 'normal' }),
    text(x + width / 2, y + height / 2 + labelSize * 0.35, label, {
      size: labelSize,
      fill: SILK.soft,
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
  ];
}

/** Surface-mount indicator LED, lit or dark. 0805 package unless told otherwise. */
export function indicatorLed(
  cx: number,
  cy: number,
  color: LedColorName,
  on: boolean,
  r = u(0.6),
): readonly Shape[] {
  const tone = LED_COLORS[color];
  const shapes: Shape[] = [];
  // Glow stays subtle and only exists while lit, so a dark board never looks hazy.
  if (on) shapes.push(circle(cx, cy, r * 2.1, { fill: tone.glow, opacity: 0.28 }));
  shapes.push(
    circle(cx, cy, r, {
      fill: on ? tone.on : tone.off,
      stroke: OUTLINE,
      strokeWidth: u(0.08),
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
    size: options.size ?? u(1.2),
    fill: options.fill ?? SILK.white,
    anchor: options.anchor ?? 'middle',
    weight: options.weight ?? 600,
    rotate: options.rotate,
    detail: options.detail,
    mono: true,
  });
}

/**
 * Pin name printed next to a header hole.
 *
 * 1.2 mm is about the smallest silkscreen a board house will print, and also
 * the smallest that survives the canvas render at 100 % zoom.
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
  size = u(1.2),
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
  const inset = variant === 'type-b' ? u(0.8) : u(0.5);
  return [
    rect(x, y, width, height, {
      rx: variant === 'type-c' ? height / 2 : u(0.3),
      fill: PART.metal,
      stroke: PART.metalDark,
      strokeWidth: u(0.13),
    }),
    rect(
      x + inset,
      y + inset,
      Math.max(width - inset * 2, u(0.2)),
      Math.max(height - inset * 2, u(0.2)),
      {
        rx: variant === 'type-c' ? (height - inset * 2) / 2 : u(0.2),
        fill: '#4a5058',
        detail: 'normal',
      },
    ),
  ];
}

/** Tactile reset button: metal cap on a dark base. 6 mm part by default. */
export function tactileButton(
  cx: number,
  cy: number,
  size = u(6),
  pressed = false,
): readonly Shape[] {
  const half = size / 2;
  return [
    rect(cx - half, cy - half, size, size, {
      rx: u(0.2),
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: u(0.1),
    }),
    circle(cx, cy, half * 0.62, {
      fill: pressed ? PART.metalDark : PART.metalLight,
      stroke: PART.metalDark,
      strokeWidth: u(0.1),
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
        strokeWidth: u(0.35),
        strokeLinejoin: 'miter',
      },
    ],
    { detail: 'normal' },
  );
}

/** Electrolytic capacitor seen from above. */
export function electrolyticCap(cx: number, cy: number, r: number): readonly Shape[] {
  return [
    circle(cx, cy, r, { fill: PART.electrolytic, stroke: OUTLINE, strokeWidth: u(0.1) }),
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

/**
 * Two-terminal axial part: a body with a wire lead out of each end.
 *
 * Resistors, diodes and film capacitors share this silhouette, and drawing them
 * from one function is what keeps their leads at a single gauge.
 */
export function axialBody(
  cx: number,
  cy: number,
  bodyWidth: number,
  bodyHeight: number,
  leadLength: number,
  fill: string,
  options: { readonly rx?: number; readonly stroke?: string } = {},
): readonly Shape[] {
  const halfWidth = bodyWidth / 2;
  const lead = u(0.28);
  // Leads run a little under the body so no seam shows where they meet it.
  const tuck = u(0.5);

  return [
    rect(cx - halfWidth - leadLength, cy - lead / 2, leadLength + tuck, lead, {
      fill: PART.solder,
    }),
    rect(cx + halfWidth - tuck, cy - lead / 2, leadLength + tuck, lead, {
      fill: PART.solder,
    }),
    rect(cx - halfWidth, cy - bodyHeight / 2, bodyWidth, bodyHeight, {
      rx: options.rx ?? bodyHeight * 0.35,
      fill,
      stroke: options.stroke ?? OUTLINE,
      strokeWidth: u(0.1),
    }),
  ];
}

/**
 * Radial through-hole part seen from above: a round can with two legs below it.
 *
 * Electrolytics, buzzers and small motors all present this way on a diagram.
 */
export function radialCan(
  cx: number,
  cy: number,
  radius: number,
  fill: string,
  options: { readonly rim?: string; readonly top?: string } = {},
): readonly Shape[] {
  return [
    circle(cx, cy, radius, {
      fill,
      stroke: options.rim ?? OUTLINE,
      strokeWidth: u(0.15),
    }),
    circle(cx, cy, radius * 0.82, {
      fill: 'none',
      stroke: options.top ?? SILK.dim,
      strokeWidth: u(0.1),
      opacity: 0.35,
      detail: 'normal',
    }),
  ];
}
