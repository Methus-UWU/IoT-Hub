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
import {
  FLAT,
  LED_COLORS,
  mixHex,
  OUTLINE,
  PART,
  PCB,
  SHADE,
  SILK,
  WOKWI,
  cylinder,
  dome,
  pcbSurface,
  type LedColorName,
} from './device-palette';
import {
  circle,
  group,
  path,
  rect,
  repeat,
  text,
  type DetailLevel,
  type Paint,
  type Shape,
} from './device-shape';

/** Standard 2.54 mm header pitch, in drawing units. */
export const PIN_PITCH = HEADER_PITCH;

/** Matte board outline for the flat schematic artwork family. */
export function flatBoard(width: number, height: number, rx = u(0.8)): readonly Shape[] {
  return [
    rect(0, 0, width, height, {
      rx,
      fill: FLAT.board,
      stroke: FLAT.boardEdge,
      strokeWidth: u(0.2),
    }),
    rect(u(0.3), u(0.3), width - u(0.6), height - u(0.6), {
      rx: Math.max(0, rx - u(0.3)),
      fill: 'none',
      stroke: FLAT.boardTrace,
      strokeWidth: u(0.1),
      detail: 'normal',
    }),
  ];
}

/** Gold posts in a flat plastic housing. */
export function flatHeader(
  x: number,
  y: number,
  count: number,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
  pitch = PIN_PITCH,
): readonly Shape[] {
  const horizontal = orientation === 'horizontal';
  const length = count * pitch;
  const thickness = u(2.5);

  return [
    rect(
      horizontal ? x - pitch / 2 : x - thickness / 2,
      horizontal ? y - thickness / 2 : y - pitch / 2,
      horizontal ? length : thickness,
      horizontal ? thickness : length,
      {
        rx: u(0.2),
        fill: FLAT.plastic,
        stroke: OUTLINE,
        strokeWidth: u(0.1),
      },
    ),
    ...repeat(
      count,
      { x: horizontal ? pitch : 0, y: horizontal ? 0 : pitch },
      (_, pinX, pinY) =>
        rect(pinX - u(0.45), pinY - u(0.45), u(0.9), u(0.9), {
          fill: FLAT.gold,
          stroke: FLAT.goldDark,
          strokeWidth: u(0.08),
        }),
      { x, y },
    ),
  ];
}

/** Matte surface-mount IC: dark body, a pin-1 strip along the top, and a part number. */
export function flatChip(
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  labelSize = u(1.1),
): readonly Shape[] {
  return [
    rect(x, y, width, height, {
      rx: u(0.28),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.12),
    }),
    rect(x + u(0.35), y + u(0.35), width - u(0.7), u(0.65), {
      rx: u(0.14),
      fill: WOKWI.chipInset,
      detail: 'normal',
    }),
    text(x + width / 2, y + height / 2 + labelSize * 0.35, label, {
      size: labelSize,
      fill: WOKWI.label,
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
  ];
}

/**
 * Matte through-hole DIP package: legs emerging from both long edges, a moulded
 * notch at one end, and a pin-1 dot. `pinsPerSide` legs run along each edge, so a
 * DIP-28 passes 14.
 */
export function flatDipChip(
  x: number,
  y: number,
  width: number,
  height: number,
  pinsPerSide: number,
  label: string,
  labelSize = u(1.1),
): readonly Shape[] {
  const pitch = width / pinsPerSide;
  const legWidth = Math.min(pitch * 0.5, u(0.8));
  const legHeight = u(1.1);
  const legInset = (pitch - legWidth) / 2;
  const notchR = height * 0.16;
  const centreY = y + height / 2;
  // Legs overlap the body by this much so they read as emerging from beneath it.
  const tuck = u(0.35);
  const leg = {
    rx: u(0.15),
    fill: WOKWI.pinLead,
    stroke: WOKWI.shieldEdge,
    strokeWidth: u(0.08),
    detail: 'normal',
  } as const;

  return [
    ...repeat(
      pinsPerSide,
      { x: pitch },
      (_, legX) => [
        rect(legX + legInset, y - legHeight + tuck, legWidth, legHeight, leg),
        rect(legX + legInset, y + height - tuck, legWidth, legHeight, leg),
      ],
      { x },
    ),
    rect(x, y, width, height, {
      rx: u(0.4),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.12),
    }),
    path(`M ${x} ${centreY - notchR} A ${notchR} ${notchR} 0 0 1 ${x} ${centreY + notchR} Z`, {
      fill: WOKWI.chipInset,
      detail: 'normal',
    }),
    circle(x + u(1.3), y + u(1.3), u(0.3), { fill: WOKWI.chipInset, detail: 'normal' }),
    text(x + width / 2, y + height / 2 + labelSize * 0.35, label, {
      size: labelSize,
      fill: WOKWI.label,
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
  ];
}

/** Matte indicator LED: a dark package ring around a flat lens colour. */
export function flatLed(cx: number, cy: number, fill: string, r = u(0.72)): readonly Shape[] {
  return [
    circle(cx, cy, r, { fill: WOKWI.espBoardEdge }),
    circle(cx, cy, (r * 2) / 3, {
      fill,
      stroke: WOKWI.buttonEdge,
      strokeWidth: u(0.08),
    }),
  ];
}

/** Matte tactile switch: a dark square base and a round cap. */
export function flatButton(
  cx: number,
  cy: number,
  size: number,
  options: { readonly cap?: string; readonly capEdge?: string } = {},
): readonly Shape[] {
  return [
    rect(cx - size / 2, cy - size / 2, size, size, {
      rx: u(0.3),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.12),
    }),
    circle(cx, cy, size * 0.34, {
      fill: options.cap ?? WOKWI.button,
      stroke: options.capEdge ?? WOKWI.buttonEdge,
      strokeWidth: u(0.14),
    }),
  ];
}

/** Matte USB socket shell with a dark mouth. */
export function flatUsbConnector(
  x: number,
  y: number,
  width: number,
  height: number,
): readonly Shape[] {
  return [
    rect(x, y, width, height, {
      rx: u(0.35),
      fill: WOKWI.usb,
      stroke: WOKWI.shieldEdge,
      strokeWidth: u(0.15),
    }),
    rect(x + u(0.55), y + u(0.65), width - u(1.1), height - u(1.05), {
      rx: u(0.2),
      fill: WOKWI.usbInset,
    }),
  ];
}

/** Matte plated mounting hole. M3 clearance unless a part asks for something else. */
export function flatMountingHole(cx: number, cy: number, r = u(1.7)): Shape {
  return group(
    [
      circle(cx, cy, r, { fill: WOKWI.shield, stroke: WOKWI.shieldEdge, strokeWidth: u(0.1) }),
      circle(cx, cy, r * 0.62, { fill: WOKWI.socket }),
    ],
    { detail: 'normal' },
  );
}

/**
 * PCB body: substrate shading plus a bright top edge and a dark bottom edge.
 *
 * The two edge hairlines are what give a board thickness. Without them a PCB
 * reads as a coloured rectangle no matter how good the shading above it is.
 */
export function board(
  x: number,
  y: number,
  width: number,
  height: number,
  fill: Paint,
  options: { readonly rx?: number; readonly edge?: string; readonly dark?: string } = {},
): readonly Shape[] {
  const rx = options.rx ?? u(1);
  // A plain colour gets shaded here; a caller that already passed a gradient
  // has said what it wants and is left alone.
  const surface =
    typeof fill === 'string'
      ? pcbSurface(fill, options.dark ?? mixHex(fill, '#000000', 0.22))
      : fill;

  return [
    rect(x, y, width, height, {
      rx,
      fill: surface,
      stroke: OUTLINE,
      strokeWidth: u(0.15),
    }),
    rect(x + u(0.25), y + u(0.25), width - u(0.5), height - u(0.5), {
      rx: Math.max(rx - u(0.25), 0),
      fill: 'none',
      stroke: options.edge ?? SILK.dim,
      strokeWidth: u(0.1),
      opacity: 0.25,
      detail: 'normal',
    }),
    // Board thickness: a lit chamfer along the top, shadow along the bottom.
    rect(x + rx, y + u(0.1), Math.max(width - rx * 2, 0), u(0.22), {
      fill: '#ffffff',
      opacity: 0.16,
      detail: 'normal',
    }),
    rect(x + rx, y + height - u(0.32), Math.max(width - rx * 2, 0), u(0.22), {
      fill: '#000000',
      opacity: 0.22,
      detail: 'normal',
    }),
  ];
}

/** Plated mounting hole. M3 clearance unless a part asks for something else. */
export function mountingHole(cx: number, cy: number, r = u(1.7)): Shape {
  return group(
    [
      circle(cx, cy, r, { fill: SHADE.solder, stroke: OUTLINE, strokeWidth: u(0.1) }),
      circle(cx, cy, r * 0.62, {
        fill: dome('#12161c', '#2b323b', '#05070a'),
      }),
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
      fill: SHADE.headerPlastic,
      stroke: OUTLINE,
      strokeWidth: u(0.1),
    }),
    ...repeat(
      count,
      { x: vertical ? 0 : pitch, y: vertical ? pitch : 0 },
      (_, holeX, holeY) => [
        rect(holeX - rim, holeY - rim, rim * 2, rim * 2, {
          rx: u(0.15),
          fill: SHADE.goldPost,
          detail: 'normal',
        }),
        // The bore is a hole, so it darkens towards its own centre rather than
        // downwards — the one place a top-down gradient would look wrong.
        rect(holeX - bore, holeY - bore, bore * 2, bore * 2, {
          rx: u(0.1),
          fill: dome('#0a0c0f', '#22282f', '#000000'),
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
      { rx: u(0.2), fill: SHADE.headerPlastic, stroke: OUTLINE, strokeWidth: u(0.1) },
    ),
    ...repeat(
      count,
      { x: horizontal ? pitch : 0, y: horizontal ? 0 : pitch },
      (_, pinX, pinY) => [
        rect(pinX - post, pinY - post, post * 2, post * 2, {
          rx: u(0.1),
          fill: SHADE.goldPost,
          stroke: PART.headerGoldDark,
          strokeWidth: u(0.08),
          detail: 'normal',
        }),
        // Specular line down the post. Square pin stock catches the light on one
        // face, and that single highlight is what separates a post from a dot.
        rect(pinX - post * 0.45, pinY - post * 0.8, post * 0.35, post * 1.6, {
          rx: u(0.05),
          fill: '#fff3cd',
          opacity: 0.5,
          detail: 'high',
        }),
      ],
      { x, y },
    ),
  ];
}

/**
 * A soldered header seen from above: a gold pad on the board and the tinned
 * lead leaving it.
 *
 * Modules in the catalog draw their headers this way because it puts the pin —
 * and therefore the wire endpoint — clear of the board instead of on top of the
 * artwork, where a wire has to cross the part to reach it.
 */
export function padLeads(
  origin: { x: number; y: number },
  step: { x?: number; y?: number },
  count: number,
  direction: 'left' | 'right' | 'up' | 'down',
  leadLength = u(4),
): readonly Shape[] {
  const pad = u(0.9);
  const leadThickness = u(0.56);
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;

  return Array.from({ length: count }, (_, index) => {
    const x = origin.x + index * (step.x ?? 0);
    const y = origin.y + index * (step.y ?? 0);
    const leadX = horizontal ? (sign < 0 ? x - leadLength : x) : x - leadThickness / 2;
    const leadY = horizontal ? y - leadThickness / 2 : sign < 0 ? y - leadLength : y;

    return [
      rect(
        leadX,
        leadY,
        horizontal ? leadLength : leadThickness,
        horizontal ? leadThickness : leadLength,
        {
          rx: leadThickness / 2,
          fill: PART.metal,
          stroke: PART.metalDark,
          strokeWidth: u(0.06),
        },
      ),
      rect(x - pad / 2, y - pad / 2, pad, pad, {
        rx: u(0.1),
        fill: SHADE.goldPost,
        stroke: PART.headerGoldDark,
        strokeWidth: u(0.08),
      }),
    ];
  }).flat();
}

/** Black surface-mount integrated circuit with a pin-1 dot and a part number. */
export function chip(
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  options: { readonly labelSize?: number; readonly fill?: Paint; readonly flat?: boolean } = {},
): readonly Shape[] {
  const labelSize = options.labelSize ?? u(1.1);
  return [
    rect(x, y, width, height, {
      rx: u(0.3),
      fill: options.fill ?? SHADE.icBody,
      stroke: OUTLINE,
      strokeWidth: u(0.1),
    }),
    // Moulded epoxy has a glossy top face; one soft band across the upper third
    // is enough to say so without turning the chip into a mirror.
    ...(options.flat
      ? []
      : [
          rect(x + u(0.25), y + u(0.25), Math.max(width - u(0.5), 0), height * 0.34, {
            rx: u(0.2),
            fill: '#ffffff',
            opacity: 0.07,
            detail: 'normal',
          }),
        ]),
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
  options: { readonly labelSize?: number; readonly fill?: Paint } = {},
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
        fill: SHADE.metal,
        stroke: PART.metalDark,
        strokeWidth: u(0.08),
        detail: 'normal',
      }),
      rect(legX + legInset, y + height - tuck, legWidth, legHeight, {
        rx: u(0.15),
        fill: SHADE.metal,
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
      fill: options.fill ?? SHADE.icBody,
      stroke: OUTLINE,
      strokeWidth: u(0.1),
    }),
    rect(x + u(0.3), y + u(0.3), Math.max(width - u(0.6), 0), height * 0.3, {
      rx: u(0.25),
      fill: '#ffffff',
      opacity: 0.06,
      detail: 'normal',
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
  if (on) {
    shapes.push(
      circle(cx, cy, r * 2.4, {
        fill: {
          kind: 'radial',
          stops: [
            { offset: 0, color: tone.glow, opacity: 0.55 },
            { offset: 1, color: tone.glow, opacity: 0 },
          ],
        },
      }),
    );
  }
  shapes.push(
    circle(cx, cy, r, {
      // A lit die is brightest at its centre; a dark one is just tinted epoxy.
      fill: on
        ? {
            kind: 'radial',
            cx: 0.42,
            cy: 0.38,
            r: 0.7,
            stops: [
              { offset: 0, color: '#ffffff' },
              { offset: 0.35, color: tone.on },
              { offset: 1, color: tone.on },
            ],
          }
        : dome(tone.off, mixHex(tone.off, '#ffffff', 0.25), mixHex(tone.off, '#000000', 0.3)),
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
      fill: SHADE.metal,
      stroke: PART.metalDark,
      strokeWidth: u(0.13),
    }),
    // The mouth is a recess: dark at its far wall, catching light at its lip.
    rect(
      x + inset,
      y + inset,
      Math.max(width - inset * 2, u(0.2)),
      Math.max(height - inset * 2, u(0.2)),
      {
        rx: variant === 'type-c' ? (height - inset * 2) / 2 : u(0.2),
        fill: {
          kind: 'linear',
          angle: 90,
          stops: [
            { offset: 0, color: '#20242a' },
            { offset: 0.6, color: '#4a5058' },
            { offset: 1, color: '#5c636c' },
          ],
        },
        detail: 'normal',
      },
    ),
    // Stamped seam down the shell, the detail that makes it read as sheet metal.
    rect(x + width / 2 - u(0.08), y + u(0.4), u(0.16), Math.max(height - u(0.8), 0), {
      fill: PART.metalDark,
      opacity: 0.5,
      detail: 'high',
    }),
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
      fill: SHADE.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: u(0.1),
    }),
    // Four solder tabs at the corners, the tell of a 6 mm tact switch.
    ...repeat(
      2,
      { x: size - u(1.1) },
      (_, tabX) => [
        rect(tabX, cy - half - u(0.5), u(1.1), u(0.7), {
          rx: u(0.1),
          fill: SHADE.metal,
          detail: 'high',
        }),
        rect(tabX, cy + half - u(0.2), u(1.1), u(0.7), {
          rx: u(0.1),
          fill: SHADE.metal,
          detail: 'high',
        }),
      ],
      { x: cx - half },
    ),
    // The dome snaps down when pressed, so it loses its highlight and gains a ring.
    circle(cx, cy, half * 0.62, {
      fill: pressed
        ? dome(PART.metalDark, PART.metal, '#5c636c')
        : dome(PART.metalLight, '#ffffff', PART.metalDark),
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
    circle(cx, cy, r, {
      fill: dome(PART.electrolytic, '#5a729c', '#111a2d'),
      stroke: OUTLINE,
      strokeWidth: u(0.1),
    }),
    // The crimped top plate sits inside the sleeve.
    circle(cx, cy, r * 0.66, { fill: dome('#1e2a3f', '#33456a', '#0d1424'), detail: 'normal' }),
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
  fill: Paint,
  options: { readonly rx?: number; readonly stroke?: string } = {},
): readonly Shape[] {
  const halfWidth = bodyWidth / 2;
  const lead = u(0.28);
  // Leads run a little under the body so no seam shows where they meet it.
  const tuck = u(0.5);
  const leadPaint = cylinderOf(PART.solder, '#ffffff', '#7f878f');

  return [
    rect(cx - halfWidth - leadLength, cy - lead / 2, leadLength + tuck, lead, {
      fill: leadPaint,
    }),
    rect(cx + halfWidth - tuck, cy - lead / 2, leadLength + tuck, lead, {
      fill: leadPaint,
    }),
    rect(cx - halfWidth, cy - bodyHeight / 2, bodyWidth, bodyHeight, {
      rx: options.rx ?? bodyHeight * 0.35,
      // A plain colour becomes a cylinder: an axial part is a barrel, and the
      // specular band along its upper third is what says so.
      fill: typeof fill === 'string' ? cylinderOf(fill) : fill,
      stroke: options.stroke ?? OUTLINE,
      strokeWidth: u(0.1),
    }),
  ];
}

/** Cylindrical shading derived from one base colour. */
function cylinderOf(base: string, light?: string, dark?: string) {
  return cylinder(
    base,
    light ?? mixHex(base, '#ffffff', 0.38),
    dark ?? mixHex(base, '#000000', 0.32),
  );
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
  fill: Paint,
  options: { readonly rim?: string; readonly top?: string } = {},
): readonly Shape[] {
  return [
    circle(cx, cy, radius, {
      fill:
        typeof fill === 'string'
          ? dome(fill, mixHex(fill, '#ffffff', 0.32), mixHex(fill, '#000000', 0.34))
          : fill,
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
