import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import {
  maleHeader,
  indicatorLed,
  silkLabel,
  usbConnector,
} from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, path, rect, text, type Shape } from '../core/device-shape';
import type { PinType } from '../core/device-types';

/**
 * ESP32 DevKit V1 — the 30-pin DOIT board.
 *
 * Geometry follows the real hardware: micro-USB at the bottom edge, the
 * ESP-WROOM-32 module filling the upper middle with its keep-out area and PCB
 * antenna at the top, EN and BOOT buttons flanking the module, and two 15-pin
 * headers down the long edges.
 *
 * The pinout is the 30-pin variant specifically. Other ESP32 boards — the 36-pin
 * DevKitC, the S3 — have different orders and must be authored as their own
 * definitions rather than reusing this one, which is why the id names the exact
 * model.
 */

const WIDTH = 232;
const HEIGHT = 396;
const HEADER_TOP = 118;
const HEADER_PITCH = 18;
const LEFT_HEADER_X = 16;
const RIGHT_HEADER_X = WIDTH - 16;

/**
 * Pin id and printed label are separate. The board prints "GND" on four holes,
 * but a wire has to name exactly one, so ids stay unique while the silkscreen
 * still reads like the real board.
 */
type PinSpec = readonly [
  id: string,
  label: string,
  type: PinType,
  detail: string,
];

/** Left header, top to bottom, USB at the bottom of the board. */
const LEFT_HEADER: readonly PinSpec[] = [
  ['3V3', '3V3', 'vcc', 'Regulated 3.3 V output, 600 mA maximum'],
  ['EN', 'EN', 'reset', 'Chip enable, active low reset'],
  ['GPIO36', 'VP/36', 'analog', 'ADC1 CH0, input only, no internal pull-up'],
  ['GPIO39', 'VN/39', 'analog', 'ADC1 CH3, input only, no internal pull-up'],
  ['GPIO34', 'D34', 'analog', 'ADC1 CH6, input only'],
  ['GPIO35', 'D35', 'analog', 'ADC1 CH7, input only'],
  ['GPIO32', 'D32', 'digital', 'ADC1 CH4, touch 9, full GPIO'],
  ['GPIO33', 'D33', 'digital', 'ADC1 CH5, touch 8, full GPIO'],
  ['GPIO25', 'D25', 'digital', 'ADC2 CH8, DAC1'],
  ['GPIO26', 'D26', 'digital', 'ADC2 CH9, DAC2'],
  ['GPIO27', 'D27', 'digital', 'ADC2 CH7, touch 7'],
  ['GPIO14', 'D14', 'digital', 'ADC2 CH6, touch 6, HSPI CLK'],
  ['GPIO12', 'D12', 'digital', 'ADC2 CH5, touch 5, HSPI MISO — strapping pin'],
  ['GND-L', 'GND', 'gnd', 'Ground reference'],
  ['GPIO13', 'D13', 'digital', 'ADC2 CH4, touch 4, HSPI MOSI'],
];

/** Right header, top to bottom. */
const RIGHT_HEADER: readonly PinSpec[] = [
  ['VIN', 'VIN', 'vcc', '5 V input, or 5 V from USB when powered over USB'],
  ['GND-R', 'GND', 'gnd', 'Ground reference'],
  ['GPIO23', 'D23', 'digital', 'VSPI MOSI'],
  ['GPIO22', 'D22', 'i2c-scl', 'Default I2C SCL'],
  ['GPIO1', 'TX0', 'uart-tx', 'UART0 TX, used by the USB bridge and boot log'],
  ['GPIO3', 'RX0', 'uart-rx', 'UART0 RX, used by the USB bridge'],
  ['GPIO21', 'D21', 'i2c-sda', 'Default I2C SDA'],
  ['GPIO19', 'D19', 'digital', 'VSPI MISO'],
  ['GPIO18', 'D18', 'digital', 'VSPI CLK'],
  ['GPIO5', 'D5', 'digital', 'VSPI CS — strapping pin, outputs PWM at boot'],
  ['GPIO17', 'TX2', 'uart-tx', 'UART2 TX'],
  ['GPIO16', 'RX2', 'uart-rx', 'UART2 RX'],
  ['GPIO4', 'D4', 'digital', 'ADC2 CH0, touch 0'],
  ['GPIO2', 'D2', 'digital', 'ADC2 CH2, touch 2, onboard LED — strapping pin'],
  ['GPIO15', 'D15', 'digital', 'ADC2 CH3, touch 3, HSPI CS — strapping pin'],
];

function headerPins(
  specs: readonly PinSpec[],
  x: number,
  side: 'left' | 'right',
): ReturnType<typeof pin>[] {
  return specs.map(([id, label, type, detail], index) =>
    pin(id, x, HEADER_TOP + index * HEADER_PITCH, type, {
      side,
      description: detail,
      aliases: label === id ? undefined : [label],
      voltage: type !== 'vcc' ? undefined : id === '3V3' ? 3.3 : 5,
    }),
  );
}

function headerLabels(
  specs: readonly PinSpec[],
  x: number,
  anchor: 'start' | 'end',
): readonly Shape[] {
  return specs.map(([, label], index) =>
    text(x, HEADER_TOP + index * HEADER_PITCH + 3, label, {
      size: 8,
      fill: SILK.white,
      anchor,
      weight: 600,
      mono: true,
      // Hidden when zoomed out: at low detail these become unreadable smudges.
      detail: 'normal',
    }),
  );
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const live = context.running;

  return [
    // PCB. Rounded corners, the proportions of a real 30-pin DevKit.
    rect(0, 0, WIDTH, HEIGHT, {
      rx: 8,
      fill: '#1f2a37',
      stroke: '#0f1720',
      strokeWidth: 2,
    }),
    rect(3, 3, WIDTH - 6, HEIGHT - 6, {
      rx: 6,
      fill: 'none',
      stroke: '#33415a',
      strokeWidth: 1,
      opacity: 0.7,
    }),

    // ESP-WROOM-32 module: metal can with the PCB antenna above it.
    rect(30, 44, WIDTH - 60, 150, {
      rx: 4,
      fill: '#c8ccd2',
      stroke: '#8a9099',
      strokeWidth: 1.5,
    }),
    rect(36, 50, WIDTH - 72, 138, {
      rx: 3,
      fill: 'none',
      stroke: '#9aa1aa',
      strokeWidth: 0.8,
      opacity: 0.8,
      detail: 'normal',
    }),
    silkLabel(WIDTH / 2, 118, 'ESP-WROOM-32', {
      size: 11,
      fill: '#3f4854',
      anchor: 'middle',
      weight: 700,
    }),
    silkLabel(WIDTH / 2, 134, 'ESP32-D0WDQ6', {
      size: 7.5,
      fill: '#5b6472',
      anchor: 'middle',
      detail: 'high',
    }),

    // Meandered PCB antenna in the keep-out area at the top.
    path(
      'M74 14h84M74 14v10M158 14v10M82 24v8M92 24v8M102 24v8M112 24v8M122 24v8M132 24v8M142 24v8M150 24v8M82 32h68',
      {
        fill: 'none',
        stroke: '#d6b45a',
        strokeWidth: 2.4,
        strokeLinecap: 'round',
      },
    ),

    // Micro-USB socket at the bottom edge.
    ...usbConnector(WIDTH / 2 - 33, HEIGHT - 30, 66, 40, 'micro'),

    // EN and BOOT buttons, flanking the module as on the real board.
    rect(18, 214, 40, 30, {
      rx: 3,
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: 1,
    }),
    circle(38, 229, 8, { fill: '#4a5261', stroke: '#2b313b', strokeWidth: 1 }),
    silkLabel(38, 256, 'EN', {
      size: 8,
      fill: SILK.white,
      anchor: 'middle',
      detail: 'normal',
    }),

    rect(WIDTH - 58, 214, 40, 30, {
      rx: 3,
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: 1,
    }),
    circle(WIDTH - 38, 229, 8, {
      fill: '#4a5261',
      stroke: '#2b313b',
      strokeWidth: 1,
    }),
    silkLabel(WIDTH - 38, 256, 'BOOT', {
      size: 8,
      fill: SILK.white,
      anchor: 'middle',
      detail: 'normal',
    }),

    // Regulator and USB-UART bridge.
    rect(84, 214, 28, 20, {
      rx: 2,
      fill: '#2b3340',
      stroke: '#151b24',
      strokeWidth: 0.8,
      detail: 'normal',
    }),
    rect(120, 214, 28, 20, {
      rx: 2,
      fill: '#2b3340',
      stroke: '#151b24',
      strokeWidth: 0.8,
      detail: 'normal',
    }),

    // Power and user LEDs. The user LED tracks GPIO2 while the sim runs.
    ...indicatorLed(96, 254, 'red', true, 4),
    ...indicatorLed(120, 254, 'blue', live, 4),
    silkLabel(96, 270, 'PWR', {
      size: 6,
      fill: SILK.white,
      anchor: 'middle',
      detail: 'high',
    }),
    silkLabel(120, 270, 'LED', {
      size: 6,
      fill: SILK.white,
      anchor: 'middle',
      detail: 'high',
    }),

    silkLabel(WIDTH / 2, HEIGHT - 44, 'ESP32 DEVKIT V1', {
      size: 8,
      fill: SILK.white,
      anchor: 'middle',
      weight: 600,
      detail: 'normal',
    }),

    // Male header pins down both long edges.
    ...maleHeader(LEFT_HEADER_X, HEADER_TOP, LEFT_HEADER.length, 'vertical', HEADER_PITCH),
    ...maleHeader(RIGHT_HEADER_X, HEADER_TOP, RIGHT_HEADER.length, 'vertical', HEADER_PITCH),

    // Silkscreen pin names, printed inboard of each header.
    ...headerLabels(LEFT_HEADER, LEFT_HEADER_X + 12, 'start'),
    ...headerLabels(RIGHT_HEADER, RIGHT_HEADER_X - 12, 'end'),
  ];
}

export const ESP32_DEVKIT_V1: VirtualDevice = {
  id: 'esp32-devkit-v1',
  name: 'ESP32 DevKit V1',
  model: 'DOIT ESP32 DevKit V1 (30-pin)',
  description:
    'ESP32-D0WDQ6 board with Wi-Fi, Bluetooth, 15 pins per side, and micro-USB programming.',
  x: 80,
  y: 60,
  width: WIDTH,
  height: HEIGHT,
  initiallyVisible: false,
  // The board prints every pin name, so the hover overlay would duplicate it.
  printsOwnPinLabels: true,
  // Header pitch is 18 units; a radius above 9 would let neighbouring pins steal
  // each other's pointer events.
  pinHitRadius: 8,
  operatingVoltage: { min: 3, max: 12, recommended: 5 },
  interfaces: ['digital', 'analog', 'pwm', 'i2c', 'spi', 'uart', 'power'],
  pins: [
    ...headerPins(LEFT_HEADER, LEFT_HEADER_X, 'left'),
    ...headerPins(RIGHT_HEADER, RIGHT_HEADER_X, 'right'),
  ],
  render: { draw, bleed: { bottom: 12 } },
  catalog: {
    categoryId: 'microcontrollers',
    category: 'Microcontrollers',
    aliases: ['esp32', 'devkit', 'doit esp32', 'wroom', 'อีเอสพี32'],
    tags: [
      'esp32',
      'wifi',
      'bluetooth',
      'microcontroller',
      'board',
      '3V3',
      'digital',
      'analog',
    ],
    interfaceLabel: 'ดิจิทัล / แอนะล็อก · 30 ขา',
    typicalUsage:
      'Wi-Fi and Bluetooth IoT projects that need plenty of GPIO and onboard radio.',
  },
};
