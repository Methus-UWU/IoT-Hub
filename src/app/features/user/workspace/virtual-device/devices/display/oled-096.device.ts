import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { PCB, SCREEN, SILK } from '../core/device-palette';
import { board, maleHeader, mountingHole, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { rect, text, type Shape } from '../core/device-shape';

/**
 * A 0.96 in I2C module: 27.3 × 27.8 mm of PCB carrying a 26.7 × 19.3 mm glass
 * panel, of which only 21.7 × 10.9 mm actually lights up. That last figure is
 * the reason the display looks like a letterbox inside a much larger frame — a
 * detail worth drawing, because it is the first thing that surprises anyone
 * wiring one of these for real.
 */
const BODY = bodyFromMm({ widthMm: 27.3, heightMm: 27.8 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

const PIN_Y = u(2.4);
const PIN_START_X = WIDTH / 2 - HEADER_PITCH * 1.5;

/** Glass panel, then the lit window inside it. */
const GLASS_W = u(26.7);
const GLASS_H = u(19.3);
const GLASS_X = (WIDTH - GLASS_W) / 2;
const GLASS_Y = u(6);
const ACTIVE_W = u(21.7);
const ACTIVE_H = u(10.9);
const ACTIVE_X = (WIDTH - ACTIVE_W) / 2;
const ACTIVE_Y = GLASS_Y + (GLASS_H - ACTIVE_H) / 2;

/** The SSD1306 panel is 128×64; text is laid out in 8×8 character cells. */
const COLUMNS = 21;
const ROWS = 4;

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
    description: 'Set by the ADDR jumper on the back of the module.',
    options: [
      { value: '0x3C', label: '0x3C (default)' },
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
  const lines = [
    stringState(context, 'line1', ''),
    stringState(context, 'line2', ''),
    stringState(context, 'line3', ''),
    stringState(context, 'line4', ''),
  ];

  const cellHeight = ACTIVE_H / ROWS;
  const fontSize = cellHeight * 0.78;

  return [
    ...board(0, 0, WIDTH, HEIGHT, PCB.blue, { rx: u(0.8), edge: PCB.blueDark }),
    mountingHole(u(2), HEIGHT - u(2), u(1.6)),
    mountingHole(WIDTH - u(2), HEIGHT - u(2), u(1.6)),

    ...maleHeader(PIN_START_X, PIN_Y, 4, 'horizontal'),

    // Glass panel. OLED pixels are emissive, so the substrate is true black
    // and only lit pixels carry colour — no backlight wash.
    rect(GLASS_X - u(0.3), GLASS_Y - u(0.3), GLASS_W + u(0.6), GLASS_H + u(0.6), {
      rx: u(0.3),
      fill: SCREEN.glassEdge,
      detail: 'normal',
    }),
    rect(GLASS_X, GLASS_Y, GLASS_W, GLASS_H, { rx: u(0.2), fill: '#15181c' }),
    // The lit window: smaller than the glass, and the only part that emits.
    rect(ACTIVE_X, ACTIVE_Y, ACTIVE_W, ACTIVE_H, { fill: SCREEN.oledBlack }),

    ...lines.flatMap((content, row) =>
      content
        ? [
            text(
              ACTIVE_X + u(0.4),
              ACTIVE_Y + row * cellHeight + cellHeight * 0.76,
              content.slice(0, COLUMNS).toUpperCase(),
              {
                size: fontSize,
                fill: SCREEN.oledPixel,
                anchor: 'start',
                weight: 600,
                mono: true,
                letterSpacing: 0.5,
                opacity: 0.55 + contrast * 0.45,
              },
            ),
          ]
        : [],
    ),

    silkLabel(WIDTH / 2, HEIGHT - u(1.4), '0.96" OLED SSD1306', {
      size: u(1.2),
      fill: SILK.soft,
      detail: 'normal',
    }),
    ...['GND', 'VCC', 'SCL', 'SDA'].map((name, index) =>
      text(PIN_START_X + index * HEADER_PITCH, PIN_Y + u(2.6), name, {
        size: u(1),
        fill: SILK.dim,
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
  operatingVoltage: { min: 3.3, max: 5, recommended: 3.3 },
  interfaces: ['i2c'],
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
  catalog: {
    categoryId: 'displays',
    category: 'Displays',
    aliases: ['oled', 'ssd1306', 'จอโอเลด', '0.96 display', 'i2c screen'],
    tags: ['oled', 'display', 'ssd1306', 'i2c', 'screen', 'monochrome', '128x64'],
    interfaceLabel: 'I2C · 4 ขา',
    typicalUsage: 'Compact status readouts, sensor dashboards, and menu interfaces.',
  },
};
