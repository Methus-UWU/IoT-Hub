import type { VirtualDevice } from '../../models/virtual-device.model';
import {
  numberState,
  stringState,
  type DeviceDrawContext,
  type DevicePropertyDefinition,
} from '../core/device-definition';
import { OUTLINE, PCB, SCREEN, SILK } from '../core/device-palette';
import { board, maleHeader, mountingHole, PIN_PITCH, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { rect, text, type Shape } from '../core/device-shape';

const WIDTH = 216;
const HEIGHT = 172;
const PIN_Y = 0;
const PIN_START_X = WIDTH / 2 - PIN_PITCH * 1.5;

const GLASS_X = 18;
const GLASS_Y = 40;
const GLASS_W = WIDTH - 36;
const GLASS_H = 104;

/** The SSD1306 panel is 128×64; text is laid out in 8×8 character cells. */
const COLUMNS = 21;
const ROWS = 4;

const PROPERTIES: readonly DevicePropertyDefinition[] = [
  {
    id: 'line1',
    label: 'Line 1',
    kind: 'text',
    defaultValue: 'IOT HUB',
    group: 'simulation',
    description: `Up to ${COLUMNS} characters.`,
  },
  { id: 'line2', label: 'Line 2', kind: 'text', defaultValue: 'OLED READY', group: 'simulation' },
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
    stringState(context, 'line1', 'IOT HUB'),
    stringState(context, 'line2', 'OLED READY'),
    stringState(context, 'line3', ''),
    stringState(context, 'line4', ''),
  ];

  const cellHeight = GLASS_H / ROWS;
  const fontSize = cellHeight * 0.68;

  return [
    ...board(0, 0, WIDTH, HEIGHT, PCB.blue, { rx: 8, edge: PCB.blueDark }),
    mountingHole(14, HEIGHT - 14, 5),
    mountingHole(WIDTH - 14, HEIGHT - 14, 5),

    ...maleHeader(PIN_START_X, PIN_Y + 14, 4, 'horizontal'),

    // Glass panel. OLED pixels are emissive, so the substrate is true black
    // and only lit pixels carry colour — no backlight wash.
    rect(GLASS_X - 3, GLASS_Y - 3, GLASS_W + 6, GLASS_H + 6, {
      rx: 3,
      fill: SCREEN.glassEdge,
      detail: 'normal',
    }),
    rect(GLASS_X, GLASS_Y, GLASS_W, GLASS_H, { rx: 2, fill: SCREEN.oledBlack }),

    ...lines.flatMap((content, row) =>
      content
        ? [
            text(
              GLASS_X + 8,
              GLASS_Y + row * cellHeight + cellHeight * 0.72,
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

    silkLabel(WIDTH / 2, HEIGHT - 12, '0.96" OLED SSD1306', { size: 9, fill: SILK.soft }),
    text(PIN_START_X - 4, PIN_Y + 34, 'GND VCC SCL SDA', {
      size: 7,
      fill: SILK.dim,
      anchor: 'start',
      mono: true,
      detail: 'high',
    }),
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
  width: WIDTH,
  height: HEIGHT,
  initiallyVisible: false,
  operatingVoltage: { min: 3.3, max: 5, recommended: 3.3 },
  interfaces: ['i2c'],
  pins: [
    pin('GND', PIN_START_X, PIN_Y, 'gnd', { side: 'top', description: 'Ground reference' }),
    pin('VCC', PIN_START_X + PIN_PITCH, PIN_Y, 'vcc', {
      side: 'top',
      description: '3.3 V or 5 V, module has an onboard regulator',
      voltage: 3.3,
    }),
    pin('SCL', PIN_START_X + PIN_PITCH * 2, PIN_Y, 'i2c-scl', {
      side: 'top',
      description: 'I2C clock',
    }),
    pin('SDA', PIN_START_X + PIN_PITCH * 3, PIN_Y, 'i2c-sda', {
      side: 'top',
      description: 'I2C data',
    }),
  ],
  properties: PROPERTIES,
  render: { draw, bleed: { top: 20 } },
  catalog: {
    categoryId: 'displays',
    category: 'Displays',
    aliases: ['oled', 'ssd1306', 'จอโอเลด', '0.96 display', 'i2c screen'],
    tags: ['oled', 'display', 'ssd1306', 'i2c', 'screen', 'monochrome', '128x64'],
    interfaceLabel: 'I2C · 4 ขา',
    typicalUsage: 'Compact status readouts, sensor dashboards, and menu interfaces.',
  },
};
