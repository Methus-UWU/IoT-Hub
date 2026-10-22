/**
 * Shared colour tokens for device artwork.
 *
 * These are deliberately *not* theme variables: a real Arduino board is teal in
 * light mode and teal in dark mode. Keeping the palette fixed is what stops the
 * artwork shifting hue between themes. Only the caption text and the drop shadow
 * around a part react to the page theme, and those live in CSS.
 */

import type { LinearGradientPaint, RadialGradientPaint } from './device-shape';

/** PCB substrate colours, picked to match the real boards they represent. */
export const PCB = {
  arduinoTeal: '#00979d',
  arduinoTealDark: '#007e83',
  espBlack: '#22262b',
  espBlackDark: '#16181c',
  green: '#1f7a4d',
  greenDark: '#17603c',
  blue: '#1e5fa8',
  blueDark: '#174a83',
  red: '#b23030',
  redDark: '#8d2525',
  purple: '#5b3a95',
  purpleDark: '#472d75',
  black: '#1c1f24',
  white: '#e8eaed',
  yellow: '#c9a227',
} as const;

/** Silkscreen printing on top of the substrate. */
export const SILK = {
  white: '#f2f4f7',
  soft: '#d6dae0',
  dim: '#9aa2ad',
} as const;

/** Component bodies. */
export const PART = {
  icBlack: '#212529',
  icGrey: '#33383f',
  icShine: '#3d444d',
  headerGold: '#e0b544',
  headerGoldDark: '#b08c2c',
  headerPlastic: '#1a1d21',
  metal: '#b9c0c9',
  metalDark: '#8d959f',
  metalLight: '#d9dee4',
  solder: '#c8cdd4',
  copper: '#c98a4b',
  plasticWhite: '#eceff3',
  plasticCream: '#e4e0d4',
  plasticBlack: '#26292e',
  plasticBlue: '#2f6fbf',
  crystal: '#c2c8d0',
  electrolytic: '#2b3a55',
  ceramicDisc: '#c9963f',
  resistorBody: '#d8b98a',
  resistorBodyDark: '#c0a274',
  wireRed: '#ef4444',
  wireBlack: '#111827',
  wireOrange: '#ea580c',
} as const;

/** LCD / OLED glass. */
export const SCREEN = {
  lcdGreen: '#7ba428',
  lcdGreenLit: '#9fce33',
  lcdBlue: '#1d4ed8',
  lcdText: '#1b2a08',
  oledBlack: '#0b0d10',
  oledPixel: '#5ad2f5',
  glassEdge: '#4a5058',
} as const;

/** Status indicator LEDs printed on boards and modules. */
export const LED_COLORS = {
  red: { off: '#7a2b2b', on: '#ff5a5a', glow: '#ff8080' },
  green: { off: '#2d6b3c', on: '#5cf07d', glow: '#8dff9f' },
  blue: { off: '#274a86', on: '#6aa8ff', glow: '#9cc6ff' },
  yellow: { off: '#7a6320', on: '#ffd83d', glow: '#ffe98a' },
  white: { off: '#8b9099', on: '#ffffff', glow: '#ffffff' },
  orange: { off: '#7d4a1c', on: '#ff9f43', glow: '#ffc182' },
} as const;

export type LedColorName = keyof typeof LED_COLORS;

/** Outline stroke used to separate a part from the canvas background. */
export const OUTLINE = '#0f172a';
export const OUTLINE_SOFT = '#33404f';

/** Flat schematic artwork: navy boards, blue controls, matte metal and gold pads. */
export const FLAT = {
  board: '#293f73',
  boardEdge: '#182b50',
  boardTrace: '#526792',
  blue: '#397dcc',
  plastic: '#20252d',
  metal: '#afb8c4',
  metalLight: '#ccd2d9',
  metalDark: '#737e8c',
  gold: '#d7c37e',
  goldDark: '#8d7b42',
  white: '#edece5',
  red: '#873432',
} as const;

/** Flat colours used by Wokwi-style modules and controller boards. */
export const WOKWI = {
  board: '#087ea4',
  boardEdge: '#07536f',
  boardTrace: '#2b96b8',
  espBoard: '#1d2a3a',
  espBoardEdge: '#0c1825',
  espBoardTrace: '#33475e',
  /** The Uno and the Mega share one substrate colour, as the real boards do. */
  arduinoBoard: '#2f739f',
  arduinoBoardEdge: '#205778',
  arduinoBoardTrace: '#5d95b9',
  relayBoard: '#2863a6',
  relayBoardEdge: '#17477d',
  relayBoardTrace: '#3977b9',
  relayCan: '#2563aa',
  relayCanActive: '#347ac2',
  terminal: '#2554d9',
  terminalEdge: '#173b9c',
  module: '#eef0f2',
  shield: '#c8cdd3',
  shieldEdge: '#858e99',
  antenna: '#c9a134',
  knob: '#c4c4c6',
  knobEdge: '#ececef',
  indicator: '#111318',
  chip: '#17212d',
  chipInset: '#2d3948',
  button: '#d8dde3',
  buttonEdge: '#919aa5',
  gold: '#e4ba36',
  goldEdge: '#92731c',
  usb: '#aeb6c0',
  usbInset: '#313b48',
  ledRed: '#f04b55',
  ledRedOff: '#85343a',
  ledBlue: '#3c70bd',
  ledBlueOff: '#283d64',
  mountingHole: '#f8fafc',
  socket: '#17212b',
  socketCenter: '#8cc4d7',
  pinLead: '#aeb7c1',
  label: '#f8fafc',
} as const;

// ------------------------------------------------------------------- shading
// Real hardware is lit from somewhere. A flat fill can state a colour but never
// a *surface*, which is why a solid grey rectangle reads as a placeholder while
// the same rectangle under a two-stop gradient reads as a stamped shield can.
//
// Every helper here returns plain gradient data. The renderer hashes it into a
// shared `<defs>` entry, so using these liberally costs one definition per
// distinct gradient across the whole artwork rather than one per shape.

/** Light falls from the top of the canvas, so this is the house angle. */
const TOP_DOWN = 90;

/**
 * A flat surface lit from above: a slightly lighter top edge easing into the
 * base colour, then a touch darker at the bottom.
 */
export function surface(base: string, light: string, dark: string): LinearGradientPaint {
  return {
    kind: 'linear',
    angle: TOP_DOWN,
    stops: [
      { offset: 0, color: light },
      { offset: 0.45, color: base },
      { offset: 1, color: dark },
    ],
  };
}

/**
 * A cylinder seen side-on: dark edge, specular band off-centre, dark edge.
 *
 * This is what makes a resistor, a capacitor can, or a header post read as
 * round rather than as a rounded rectangle.
 */
export function cylinder(base: string, light: string, dark: string): LinearGradientPaint {
  return {
    kind: 'linear',
    angle: TOP_DOWN,
    stops: [
      { offset: 0, color: dark },
      { offset: 0.28, color: light },
      { offset: 0.55, color: base },
      { offset: 1, color: dark },
    ],
  };
}

/** A dome lit from the upper left: plastic buttons, LED heads, sensor lenses. */
export function dome(base: string, light: string, dark: string): RadialGradientPaint {
  return {
    kind: 'radial',
    cx: 0.36,
    cy: 0.32,
    r: 0.72,
    stops: [
      { offset: 0, color: light },
      { offset: 0.55, color: base },
      { offset: 1, color: dark },
    ],
  };
}

/** Prebuilt surfaces for the materials the catalog uses over and over. */
export const SHADE = {
  goldPost: cylinder(PART.headerGold, '#f6d97c', PART.headerGoldDark),
  headerPlastic: surface(PART.headerPlastic, '#2b3037', '#0d0f12'),
  metal: cylinder(PART.metal, PART.metalLight, PART.metalDark),
  metalFlat: surface(PART.metal, PART.metalLight, PART.metalDark),
  icBody: surface(PART.icBlack, '#3a4047', '#14171b'),
  icGrey: surface(PART.icGrey, '#4b525b', '#20242a'),
  solder: dome(PART.solder, '#f2f5f8', '#8f979f'),
  copper: cylinder(PART.copper, '#e8b177', '#96612f'),
  electrolytic: cylinder(PART.electrolytic, '#4a628c', '#16203a'),
  resistorBody: cylinder(PART.resistorBody, '#f0d9b4', '#a98a5f'),
  plasticWhite: surface(PART.plasticWhite, '#ffffff', '#c6ccd4'),
  plasticBlack: surface(PART.plasticBlack, '#3a3f46', '#131519'),
  plasticBlue: surface(PART.plasticBlue, '#4f92e6', '#1f4c88'),
  plasticCream: surface(PART.plasticCream, '#f2efe6', '#c3bda9'),
  glass: {
    kind: 'linear',
    angle: 115,
    stops: [
      { offset: 0, color: '#ffffff', opacity: 0.22 },
      { offset: 0.45, color: '#ffffff', opacity: 0.05 },
      { offset: 1, color: '#000000', opacity: 0.12 },
    ],
  } as LinearGradientPaint,
} as const;

/** PCB substrate shading, derived from the board's own two palette tones. */
export function pcbSurface(base: string, dark: string): LinearGradientPaint {
  return surface(base, mixHex(base, '#ffffff', 0.14), dark);
}

/** Blends two hex colours. Used so a board's highlight follows its own hue. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const channel = (index: number): number => Math.round(a[index] + (b[index] - a[index]) * amount);
  return `#${[channel(0), channel(1), channel(2)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function parseHex(value: string): [number, number, number] {
  const hex = value.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((character) => character + character)
          .join('')
      : hex;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}
