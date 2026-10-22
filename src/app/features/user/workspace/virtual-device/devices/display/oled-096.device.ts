import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { PCB, SCREEN, SILK } from '../core/device-palette';
import { pin } from '../core/device-pin';
import { circle, path, rect, text, type Shape } from '../core/device-shape';
import { requiresSupply } from '../core/device-simulation';
import { i2cTextDisplay } from '../core/bus-peripherals';

/**
 * A compact 0.96 in I2C module. The canvas artwork keeps the blue PCB visible
 * around a large display and leaves the connector labels directly below the
 * header so the pinout remains readable at normal zoom.
 */
const BODY = bodyFromMm({ widthMm: 27.3, heightMm: 27.8 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

const PIN_Y = u(2.4);
const PIN_START_X = WIDTH / 2 - HEADER_PITCH * 1.5;
const BOARD_RADIUS = u(0.8);
const MOUNTING_HOLE_INSET = u(2);
const MOUNTING_HOLE_RADIUS = u(1.1);

/** Large front glass with a narrow bezel, matching the module's canvas artwork. */
const GLASS_W = WIDTH - u(1.6);
const GLASS_H = u(18.6);
const GLASS_X = (WIDTH - GLASS_W) / 2;
const GLASS_Y = u(5.4);
/** The SSD1306's lit area on a 0.96 in module: 21.74 × 10.86 mm, 2:1 like its pixels. */
const ACTIVE_W = u(21.74);
const ACTIVE_H = u(10.86);
const ACTIVE_X = (WIDTH - ACTIVE_W) / 2;
const ACTIVE_Y = GLASS_Y + (GLASS_H - ACTIVE_H) / 2;

/** The SSD1306 panel is 128×64 pixels. */
const PANEL_W = 128;
const PANEL_H = 64;
const PIXEL = ACTIVE_W / PANEL_W;
/** The built-in GFX font: 6×8 cells, so 21 characters fit a row at size 1. */
const CHAR_W = 6;
const CHAR_H = 8;
const COLUMNS = Math.floor(PANEL_W / CHAR_W);
/** Inspector rows, drawn where a sketch printing one line per 16 px would put them. */
const ROWS = 4;
const INSPECTOR_ROW_PX = 16;

interface TextRun {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly text: string;
}

/** A frame from the SSD1306 library: runs encoded as `x|y|size|text`. */
function parseFrame(raw: string): TextRun[] | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return null;
    return value.flatMap((entry) => {
      if (typeof entry !== 'string') return [];
      const [x, y, size, ...rest] = entry.split('|');
      const run = { x: Number(x), y: Number(y), size: Number(size), text: rest.join('|') };
      return Number.isFinite(run.x) && Number.isFinite(run.y) && run.size > 0 ? [run] : [];
    });
  } catch {
    return null;
  }
}

/** Blue PCB outline with true cut-outs, so the canvas remains visible through the holes. */
const BOARD_PATH = [
  `M ${BOARD_RADIUS} 0 H ${WIDTH - BOARD_RADIUS}`,
  `A ${BOARD_RADIUS} ${BOARD_RADIUS} 0 0 1 ${WIDTH} ${BOARD_RADIUS}`,
  `V ${HEIGHT - BOARD_RADIUS}`,
  `A ${BOARD_RADIUS} ${BOARD_RADIUS} 0 0 1 ${WIDTH - BOARD_RADIUS} ${HEIGHT}`,
  `H ${BOARD_RADIUS}`,
  `A ${BOARD_RADIUS} ${BOARD_RADIUS} 0 0 1 0 ${HEIGHT - BOARD_RADIUS}`,
  `V ${BOARD_RADIUS}`,
  `A ${BOARD_RADIUS} ${BOARD_RADIUS} 0 0 1 ${BOARD_RADIUS} 0 Z`,
  ...[
    [MOUNTING_HOLE_INSET, MOUNTING_HOLE_INSET],
    [WIDTH - MOUNTING_HOLE_INSET, MOUNTING_HOLE_INSET],
    [MOUNTING_HOLE_INSET, HEIGHT - MOUNTING_HOLE_INSET],
    [WIDTH - MOUNTING_HOLE_INSET, HEIGHT - MOUNTING_HOLE_INSET],
  ].map(
    ([cx, cy]) =>
      `M ${cx - MOUNTING_HOLE_RADIUS} ${cy}` +
      ` A ${MOUNTING_HOLE_RADIUS} ${MOUNTING_HOLE_RADIUS} 0 1 0 ${cx + MOUNTING_HOLE_RADIUS} ${cy}` +
      ` A ${MOUNTING_HOLE_RADIUS} ${MOUNTING_HOLE_RADIUS} 0 1 0 ${cx - MOUNTING_HOLE_RADIUS} ${cy} Z`,
  ),
].join(' ');

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  // Blank by default. A screen that shows invented text before the user has
  // written any is a screen that misrepresents the circuit.
  {
    id: 'line1',
    label: 'Line 1',
    kind: 'text',
    defaultValue: '',
    group: 'simulation',
    description: `Up to ${COLUMNS} characters.`,
  },
  { id: 'line2', label: 'Line 2', kind: 'text', defaultValue: '', group: 'simulation' },
  { id: 'line3', label: 'Line 3', kind: 'text', defaultValue: '', group: 'simulation' },
  { id: 'line4', label: 'Line 4', kind: 'text', defaultValue: '', group: 'simulation' },
  {
    id: 'address',
    label: 'I2C address',
    kind: 'select',
    defaultValue: '0x3C',
    group: 'advanced',
    description: 'Set by the ADDR jumper on the back of the module. 0x3C is the default.',
    options: [
      { value: '0x3C', label: '0x3C' },
      { value: '0x3D', label: '0x3D' },
    ],
  },
  {
    id: 'contrast',
    label: 'Contrast',
    kind: 'number',
    defaultValue: 200,
    min: 0,
    max: 255,
    step: 1,
    group: 'advanced',
  },
];

function draw(context: DeviceDrawContext): readonly Shape[] {
  const contrast = numberState(context, 'contrast', 200) / 255;
  // A running sketch's frame wins; otherwise the inspector's rows are shown the
  // way a sketch printing one row per 16 px would put them.
  const frame = parseFrame(stringState(context, 'frame', ''));
  const runs: readonly TextRun[] =
    frame ??
    Array.from({ length: ROWS }, (_, row) => ({
      x: 0,
      y: row * INSPECTOR_ROW_PX,
      size: 1,
      text: stringState(context, `line${row + 1}`, '').slice(0, COLUMNS),
    }));

  return [
    // Keep this module on flat paints. It is rendered inside repeated SVG
    // artwork where document-wide gradient ids are not guaranteed to resolve.
    path(BOARD_PATH, {
      fill: PCB.blue,
      stroke: PCB.blueDark,
      strokeWidth: u(0.2),
      fillRule: 'evenodd',
    }),

    ...Array.from({ length: 4 }, (_, index) => {
      const cx = PIN_START_X + index * HEADER_PITCH;
      return [
        circle(cx, PIN_Y, u(0.9), { fill: '#e5b85c' }),
        circle(cx, PIN_Y, u(0.55), { fill: '#fffaf0' }),
      ];
    }).flat(),

    // OLED pixels are emissive, so the substrate is true black and only lit
    // pixels carry colour; there is no backlight wash.
    rect(GLASS_X - u(0.3), GLASS_Y - u(0.3), GLASS_W + u(0.6), GLASS_H + u(0.6), {
      rx: u(0.3),
      fill: SCREEN.glassEdge,
      detail: 'normal',
    }),
    rect(GLASS_X, GLASS_Y, GLASS_W, GLASS_H, { rx: u(0.2), fill: '#15181c' }),
    // The lit window: smaller than the glass, and the only part that emits.
    rect(ACTIVE_X, ACTIVE_Y, ACTIVE_W, ACTIVE_H, { fill: SCREEN.oledBlack }),

    // One glyph per 6×8 cell on the 128×64 grid, each placed at its own cell so
    // font metrics can never push text past the panel edge. A cell that does
    // not fit on the panel is not drawn, as on the real glass.
    ...runs.flatMap((run) =>
      [...run.text].flatMap((character, index) => {
        const px = run.x + index * CHAR_W * run.size;
        if (character === ' ' || px + (CHAR_W - 1) * run.size > PANEL_W) return [];
        if (run.y < 0 || run.y + (CHAR_H - 1) * run.size > PANEL_H) return [];
        return [
          text(
            ACTIVE_X + (px + (CHAR_W * run.size) / 2) * PIXEL,
            ACTIVE_Y + (run.y + (CHAR_H - 1.5) * run.size) * PIXEL,
            character,
            {
              size: CHAR_H * run.size * PIXEL * 1.05,
              fill: SCREEN.oledPixel,
              anchor: 'middle',
              weight: 500,
              mono: true,
              opacity: 0.55 + contrast * 0.45,
            },
          ),
        ];
      }),
    ),

    ...['GND', 'VCC', 'SCL', 'SDA'].map((name, index) =>
      text(PIN_START_X + index * HEADER_PITCH, PIN_Y + u(2.4), name, {
        size: u(1),
        fill: SILK.white,
        anchor: 'middle',
        mono: true,
        weight: 600,
        detail: 'normal',
      }),
    ),
  ];
}

/** 0.96 inch monochrome OLED on the SSD1306 controller, I2C wired. */
export const OLED_096_I2C: VirtualDevice = {
  id: 'oled-096-i2c',
  name: 'OLED display 0.96"',
  model: 'SSD1306 128×64 I2C',
  description: 'Self-emissive 128×64 monochrome panel driven over I2C.',
  x: 640,
  y: 120,
  ...BODY,
  initiallyVisible: false,
  printsOwnPinLabels: true,
  operatingVoltage: { min: 3.3, max: 5, recommended: 3.3 },
  interfaces: ['i2c'],
  i2cAddress: { property: 'address', fallback: '0x3C' },
  pins: [
    pin('GND', PIN_START_X, PIN_Y, 'gnd', { side: 'top', description: 'Ground reference' }),
    pin('VCC', PIN_START_X + HEADER_PITCH, PIN_Y, 'vcc', {
      side: 'top',
      description: '3.3 V or 5 V, module has an onboard regulator',
      voltage: 3.3,
    }),
    pin('SCL', PIN_START_X + HEADER_PITCH * 2, PIN_Y, 'i2c-scl', {
      side: 'top',
      description: 'I2C clock',
    }),
    pin('SDA', PIN_START_X + HEADER_PITCH * 3, PIN_Y, 'i2c-sda', {
      side: 'top',
      description: 'I2C data',
    }),
  ],
  properties: PROPERTIES,
  render: { draw },
  // Shows what Adafruit_SSD1306 sends to its address once display() is called.
  simulation: requiresSupply(
    i2cTextDisplay({
      sdaPin: 'SDA',
      chip: 'ssd1306',
      protocol: 'ssd1306',
      rows: ROWS,
      address: { property: 'address', fallback: '0x3C' },
    }),
    { minimumVolts: 3 },
  ),
  catalog: {
    categoryId: 'displays',
    category: 'Displays',
    aliases: ['oled', 'ssd1306', 'จอโอเลด', '0.96 display', 'i2c screen'],
    tags: ['oled', 'display', 'ssd1306', 'i2c', 'screen', 'monochrome', '128x64'],
    interfaceLabel: 'I2C · 4 ขา',
    typicalUsage: 'Compact status readouts, sensor dashboards, and menu interfaces.',
  },
};
