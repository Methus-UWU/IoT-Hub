import type { OnboardLed, VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { WOKWI } from '../core/device-palette';
import {
  flatButton,
  flatChip,
  flatHeader,
  flatLed,
  flatUsbConnector,
  silkLabel,
} from '../core/device-parts';
import { pin } from '../core/device-pin';
import { rect, text, type Shape } from '../core/device-shape';
import type { PinType } from '../core/device-types';
import { createBoardBehavior, ESP32_RUNTIME, onboardLedColor } from './board-behavior';

/**
 * ESP32 DevKit V1 — the 30-pin DOIT board.
 *
 * Drawn to the real hardware: a 28.3 × 51.4 mm PCB with its two header rows
 * exactly one inch apart, the ESP-WROOM-32 module filling the upper half with
 * its antenna keep-out overhanging the top edge, EN and BOOT buttons below it,
 * and the micro-USB shell hanging off the bottom edge.
 *
 * Every coordinate below is `u(millimetres)`, so the board is the same size
 * relative to a servo or a resistor as it is on a desk. The header rows fall out
 * of that automatically: at 2.54 mm pitch, fifteen pins span 35.6 mm, which is
 * why the board is 51.4 mm long and not some arbitrary number.
 *
 * The pinout is the 30-pin variant specifically. Other ESP32 boards — the 36-pin
 * DevKitC, the S3 — order their headers differently and must be authored as
 * their own definitions, which is why the id names the exact model.
 */

const BODY = bodyFromMm({ widthMm: 28.3, heightMm: 51.4 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

/** Header rows sit one inch apart, centred across the board. */
const LEFT_HEADER_X = (WIDTH - u(25.4)) / 2;
const RIGHT_HEADER_X = WIDTH - LEFT_HEADER_X;
const HEADER_TOP = u(10);

/** The WROOM module, centred, with the antenna at the top edge. */
const MODULE_WIDTH = u(18);
const MODULE_X = (WIDTH - MODULE_WIDTH) / 2;
const MODULE_TOP = u(1);
const MODULE_HEIGHT = u(25.5);
const SHIELD_TOP = MODULE_TOP + u(6.5);

/**
 * Pin id and printed label are separate. The board prints "GND" on four holes,
 * but a wire has to name exactly one, so ids stay unique while the silkscreen
 * still reads like the real board.
 *
 * Labels are kept to three characters because that is all that fits in the
 * 3.7 mm strip between a header and the module — the same constraint that made
 * DOIT print "D23" rather than "GPIO23".
 */
type PinSpec = readonly [id: string, label: string, type: PinType, detail: string];

/** Left header, top to bottom, USB at the bottom of the board. */
const LEFT_HEADER: readonly PinSpec[] = [
  ['3V3', '3V3', 'vcc', 'Regulated 3.3 V output, 600 mA maximum'],
  ['EN', 'EN', 'reset', 'Chip enable, active low reset'],
  ['GPIO36', 'VP', 'analog', 'GPIO36 · ADC1 CH0, input only, no internal pull-up'],
  ['GPIO39', 'VN', 'analog', 'GPIO39 · ADC1 CH3, input only, no internal pull-up'],
  ['GPIO34', 'D34', 'analog', 'GPIO34 · ADC1 CH6, input only'],
  ['GPIO35', 'D35', 'analog', 'GPIO35 · ADC1 CH7, input only'],
  ['GPIO32', 'D32', 'digital', 'GPIO32 · ADC1 CH4, touch 9, full GPIO'],
  ['GPIO33', 'D33', 'digital', 'GPIO33 · ADC1 CH5, touch 8, full GPIO'],
  ['GPIO25', 'D25', 'digital', 'GPIO25 · ADC2 CH8, DAC1'],
  ['GPIO26', 'D26', 'digital', 'GPIO26 · ADC2 CH9, DAC2'],
  ['GPIO27', 'D27', 'digital', 'GPIO27 · ADC2 CH7, touch 7'],
  ['GPIO14', 'D14', 'digital', 'GPIO14 · ADC2 CH6, touch 6, HSPI CLK'],
  ['GPIO12', 'D12', 'digital', 'GPIO12 · ADC2 CH5, touch 5, HSPI MISO — strapping pin'],
  ['GND-L', 'GND', 'gnd', 'Ground reference'],
  ['GPIO13', 'D13', 'digital', 'GPIO13 · ADC2 CH4, touch 4, HSPI MOSI'],
];

/** Right header, top to bottom. */
const RIGHT_HEADER: readonly PinSpec[] = [
  ['VIN', 'VIN', 'vcc', '5 V input, or 5 V from USB when powered over USB'],
  ['GND-R', 'GND', 'gnd', 'Ground reference'],
  ['GPIO23', 'D23', 'digital', 'GPIO23 · VSPI MOSI'],
  ['GPIO22', 'D22', 'i2c-scl', 'GPIO22 · default I2C SCL'],
  ['GPIO1', 'TX0', 'uart-tx', 'GPIO1 · UART0 TX, used by the USB bridge and boot log'],
  ['GPIO3', 'RX0', 'uart-rx', 'GPIO3 · UART0 RX, used by the USB bridge'],
  ['GPIO21', 'D21', 'i2c-sda', 'GPIO21 · default I2C SDA'],
  ['GPIO19', 'D19', 'digital', 'GPIO19 · VSPI MISO'],
  ['GPIO18', 'D18', 'digital', 'GPIO18 · VSPI CLK'],
  ['GPIO5', 'D5', 'digital', 'GPIO5 · VSPI CS — strapping pin, outputs PWM at boot'],
  ['GPIO17', 'TX2', 'uart-tx', 'GPIO17 · UART2 TX'],
  ['GPIO16', 'RX2', 'uart-rx', 'GPIO16 · UART2 RX'],
  ['GPIO4', 'D4', 'digital', 'GPIO4 · ADC2 CH0, touch 0'],
  ['GPIO2', 'D2', 'digital', 'GPIO2 · ADC2 CH2, touch 2, onboard LED — strapping pin'],
  ['GPIO15', 'D15', 'digital', 'GPIO15 · ADC2 CH3, touch 3, HSPI CS — strapping pin'],
];

/** The board's user LED: what `LED_BUILTIN` names, and what the artwork lights. */
const ONBOARD_LED: OnboardLed = { pin: 'GPIO2', label: 'LED' };

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
      maxCurrentMa: id === '3V3' ? 600 : undefined,
    }),
  );
}

function headerLabels(
  specs: readonly PinSpec[],
  x: number,
  anchor: 'start' | 'end',
): readonly Shape[] {
  return specs.map(([, label], index) =>
    text(x, HEADER_TOP + index * HEADER_PITCH + u(0.35), label, {
      size: u(0.9),
      fill: WOKWI.label,
      anchor,
      weight: 600,
      mono: true,
      // Hidden when zoomed out: at low detail these become unreadable smudges.
      detail: 'normal',
    }),
  );
}

function draw(context: DeviceDrawContext): readonly Shape[] {

  return [
    // PCB.
    rect(0, 0, WIDTH, HEIGHT, {
      rx: u(1),
      fill: WOKWI.espBoard,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.2),
    }),
    rect(u(0.3), u(0.3), WIDTH - u(0.6), HEIGHT - u(0.6), {
      rx: u(0.8),
      fill: 'none',
      stroke: WOKWI.espBoardTrace,
      strokeWidth: u(0.1),
      opacity: 0.7,
      detail: 'normal',
    }),

    // ESP-WROOM-32: a metal shield can with the antenna keep-out above it.
    rect(MODULE_X, MODULE_TOP, MODULE_WIDTH, MODULE_HEIGHT, {
      rx: u(0.4),
      fill: WOKWI.module,
      stroke: WOKWI.shieldEdge,
      strokeWidth: u(0.12),
    }),
    // Meandered PCB antenna, printed on the module's own substrate.
    {
      kind: 'path',
      d: [
        `M ${MODULE_X + u(2)} ${MODULE_TOP + u(1.4)}`,
        `h ${u(14)}`,
        `M ${MODULE_X + u(2)} ${MODULE_TOP + u(1.4)} v ${u(1.4)}`,
        `M ${MODULE_X + u(16)} ${MODULE_TOP + u(1.4)} v ${u(1.4)}`,
        `M ${MODULE_X + u(3)} ${MODULE_TOP + u(2.8)} v ${u(1.6)}`,
        `M ${MODULE_X + u(5)} ${MODULE_TOP + u(2.8)} v ${u(1.6)}`,
        `M ${MODULE_X + u(7)} ${MODULE_TOP + u(2.8)} v ${u(1.6)}`,
        `M ${MODULE_X + u(9)} ${MODULE_TOP + u(2.8)} v ${u(1.6)}`,
        `M ${MODULE_X + u(11)} ${MODULE_TOP + u(2.8)} v ${u(1.6)}`,
        `M ${MODULE_X + u(13)} ${MODULE_TOP + u(2.8)} v ${u(1.6)}`,
        `M ${MODULE_X + u(15)} ${MODULE_TOP + u(2.8)} v ${u(1.6)}`,
        `M ${MODULE_X + u(3)} ${MODULE_TOP + u(4.4)} h ${u(12)}`,
      ].join(' '),
      fill: 'none',
      stroke: WOKWI.antenna,
      strokeWidth: u(0.3),
      strokeLinecap: 'round',
    },
    // Shield can, kept matte to match the Wokwi reference artwork.
    rect(
      MODULE_X + u(0.3),
      SHIELD_TOP,
      MODULE_WIDTH - u(0.6),
      MODULE_TOP + MODULE_HEIGHT - SHIELD_TOP - u(0.3),
      {
        rx: u(0.3),
        fill: WOKWI.shield,
        stroke: WOKWI.shieldEdge,
        strokeWidth: u(0.15),
      },
    ),
    rect(
      MODULE_X + u(1),
      SHIELD_TOP + u(0.7),
      MODULE_WIDTH - u(2),
      MODULE_TOP + MODULE_HEIGHT - SHIELD_TOP - u(1.7),
      {
        rx: u(0.2),
        fill: 'none',
        stroke: WOKWI.buttonEdge,
        strokeWidth: u(0.08),
        detail: 'normal',
      },
    ),
    silkLabel(WIDTH / 2, SHIELD_TOP + u(8), 'ESP-WROOM-32', {
      size: u(1.15),
      fill: WOKWI.espBoard,
      weight: 700,
      detail: 'normal',
    }),
    silkLabel(WIDTH / 2, SHIELD_TOP + u(10.2), 'ESP32-D0WDQ6', {
      size: u(0.8),
      fill: WOKWI.espBoardTrace,
      detail: 'high',
    }),

    // EN and BOOT. Both sit inboard of the headers: a 6 mm cap centred on the
    // pin row would swallow the clicks meant for the pins underneath it.
    ...flatButton(u(7.9), u(29.5), u(6)),
    silkLabel(u(7.9), u(34), 'EN', { size: u(0.9), detail: 'normal' }),
    ...flatButton(WIDTH - u(7.9), u(29.5), u(6)),
    silkLabel(WIDTH - u(7.9), u(34), 'BOOT', { size: u(0.9), detail: 'normal' }),

    // AMS1117 regulator and the CP2102 USB-UART bridge, in the gap between them.
    ...flatChip(u(11.5), u(26.8), u(5.3), u(3.2), 'AMS', u(0.75)),
    ...flatChip(u(11.6), u(31), u(5), u(5), 'CP2102', u(0.7)),

    // Power and user LEDs. The user LED follows GPIO2 while the sim runs.
    ...flatLed(u(12.4), u(37.5), WOKWI.ledRed),
    ...flatLed(u(15.9), u(37.5), onboardLedColor(context, WOKWI.ledBlue, WOKWI.ledBlueOff)),
    silkLabel(u(12.4), u(39.6), 'PWR', { size: u(0.7), detail: 'high' }),
    silkLabel(u(15.9), u(39.6), 'LED', { size: u(0.7), detail: 'high' }),

    // Decoupling caps, drawn only when zoomed in.
    rect(u(9.6), u(36.9), u(1.8), u(1.2), {
      rx: u(0.2),
      fill: WOKWI.module,
      detail: 'high',
    }),
    rect(u(17.9), u(36.9), u(1.8), u(1.2), {
      rx: u(0.2),
      fill: WOKWI.module,
      detail: 'high',
    }),

    silkLabel(WIDTH / 2, u(43), 'ESP32 DEVKIT V1', {
      size: u(1.1),
      weight: 600,
      detail: 'normal',
    }),

    // Micro-USB, overhanging the bottom edge exactly as the socket does.
    ...flatUsbConnector(WIDTH / 2 - u(3.75), HEIGHT - u(4), u(7.5), u(5.5)),

    // Male header pins down both long edges.
    ...flatHeader(LEFT_HEADER_X, HEADER_TOP, LEFT_HEADER.length, 'vertical'),
    ...flatHeader(RIGHT_HEADER_X, HEADER_TOP, RIGHT_HEADER.length, 'vertical'),

    // Silkscreen pin names, printed inboard of each header.
    // Half a header's width plus a gap, so names print beside the plastic, not on it.
    ...headerLabels(LEFT_HEADER, LEFT_HEADER_X + u(1.6), 'start'),
    ...headerLabels(RIGHT_HEADER, RIGHT_HEADER_X - u(1.6), 'end'),
  ];
}

export const ESP32_DEVKIT_V1: VirtualDevice = {
  defaultSpi: { mosi: 'GPIO23', miso: 'GPIO19', clock: 'GPIO18', select: 'GPIO5' },
  id: 'esp32-devkit-v1',
  name: 'ESP32 DevKit V1',
  model: 'DOIT ESP32 DevKit V1 (30-pin)',
  description:
    'ESP32-D0WDQ6 board with Wi-Fi, Bluetooth, 15 pins per side, and micro-USB programming.',
  x: 80,
  y: 60,
  ...BODY,
  initiallyVisible: false,
  // The board prints every pin name, so the hover overlay would duplicate it.
  printsOwnPinLabels: true,
  powerSource: true,
  logicVoltage: 3.3,
  maxLogicInputVoltage: 3.6,
  operatingVoltage: { min: 3, max: 12, recommended: 5 },
  interfaces: ['digital', 'analog', 'pwm', 'i2c', 'spi', 'uart', 'power'],
  pins: [
    ...headerPins(LEFT_HEADER, LEFT_HEADER_X, 'left'),
    ...headerPins(RIGHT_HEADER, RIGHT_HEADER_X, 'right'),
  ],
  render: { draw, bleed: { bottom: u(1.5) } },
  onboardLed: ONBOARD_LED,
  simulation: (instanceId) => createBoardBehavior(instanceId, ESP32_RUNTIME, ONBOARD_LED),
  catalog: {
    categoryId: 'microcontrollers',
    category: 'Microcontrollers',
    aliases: ['esp32', 'devkit', 'doit esp32', 'wroom', 'อีเอสพี32'],
    tags: ['esp32', 'wifi', 'bluetooth', 'microcontroller', 'board', '3V3', 'digital', 'analog'],
    interfaceLabel: 'ดิจิทัล / แอนะล็อก · 30 ขา',
    typicalUsage: 'Wi-Fi and Bluetooth IoT projects that need plenty of GPIO and onboard radio.',
  },
};
