/**
 * Shared colour tokens for device artwork.
 *
 * These are deliberately *not* theme variables: a real Arduino board is teal in
 * light mode and teal in dark mode. Keeping the palette fixed is what stops the
 * artwork shifting hue between themes. Only the caption text and the drop shadow
 * around a part react to the page theme, and those live in CSS.
 */

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
