import type { OnboardLed, VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { SILK, WOKWI } from '../core/device-palette';
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
 * ESP32 DevKit V1 — the 38-pin DOIT board.
 *
 * The sibling of the 30-pin part, and not a superset of it: the 38-pin variant
 * breaks out the six pins wired to the module's own SPI flash (GPIO6–11) plus a
 * second ground on each side, and it orders its headers differently. Two boards
 * this close together earn separate definitions precisely because a wire to
 * "the ESP32" has to mean one exact hole.
 *
 * 28.3 × 54.4 mm, headers one inch apart, nineteen holes per side at 2.54 mm.
 * Nineteen holes span 45.7 mm, which is why the PCB is 54.4 mm long rather than
 * some round number.
 *
 * GPIO6–11 are brought out but are *not* usable: they are hard-wired to the SPI
 * flash the chip boots from. Their descriptions say so, because a beginner
 * wiring a sensor to SD0 is the single most common way to brick a sketch.
 */

const BODY = bodyFromMm({ widthMm: 28.3, heightMm: 54.4 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

const PINS_PER_SIDE = 19;

/** Header rows sit one inch apart, centred across the board. */
const LEFT_HEADER_X = (WIDTH - u(25.4)) / 2;
const RIGHT_HEADER_X = WIDTH - LEFT_HEADER_X;
/** Nineteen holes span 18 × 2.54 mm; centring them fixes the first row. */
const HEADER_TOP = (HEIGHT - (PINS_PER_SIDE - 1) * HEADER_PITCH) / 2;

/** The WROOM module, centred, antenna at the top edge. */
const MODULE_WIDTH = u(18);
const MODULE_X = (WIDTH - MODULE_WIDTH) / 2;
const MODULE_TOP = u(1.2);
const MODULE_HEIGHT = u(25.5);
const SHIELD_TOP = MODULE_TOP + u(6.5);

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
  ['GPIO9', 'SD2', 'nc', 'GPIO9 · wired to the onboard SPI flash — do not use'],
  ['GPIO10', 'SD3', 'nc', 'GPIO10 · wired to the onboard SPI flash — do not use'],
  ['GPIO11', 'CMD', 'nc', 'GPIO11 · wired to the onboard SPI flash — do not use'],
  ['VIN', 'VIN', 'vcc', '5 V input, or 5 V from USB when powered over USB'],
];

/** Right header, top to bottom. */
const RIGHT_HEADER: readonly PinSpec[] = [
  ['GND-R1', 'GND', 'gnd', 'Ground reference'],
  ['GPIO23', 'D23', 'digital', 'GPIO23 · VSPI MOSI'],
  ['GPIO22', 'D22', 'i2c-scl', 'GPIO22 · default I2C SCL'],
  ['GPIO1', 'TX0', 'uart-tx', 'GPIO1 · UART0 TX, used by the USB bridge and boot log'],
  ['GPIO3', 'RX0', 'uart-rx', 'GPIO3 · UART0 RX, used by the USB bridge'],
  ['GPIO21', 'D21', 'i2c-sda', 'GPIO21 · default I2C SDA'],
  ['GND-R2', 'GND', 'gnd', 'Ground reference'],
  ['GPIO19', 'D19', 'digital', 'GPIO19 · VSPI MISO'],
  ['GPIO18', 'D18', 'digital', 'GPIO18 · VSPI CLK'],
  ['GPIO5', 'D5', 'digital', 'GPIO5 · VSPI CS — strapping pin, outputs PWM at boot'],
  ['GPIO17', 'TX2', 'uart-tx', 'GPIO17 · UART2 TX'],
  ['GPIO16', 'RX2', 'uart-rx', 'GPIO16 · UART2 RX'],
  ['GPIO4', 'D4', 'digital', 'GPIO4 · ADC2 CH0, touch 0'],
  ['GPIO0', 'D0', 'digital', 'GPIO0 · boot mode select — held low to enter flashing'],
  ['GPIO2', 'D2', 'digital', 'GPIO2 · ADC2 CH2, touch 2, onboard LED — strapping pin'],
  ['GPIO15', 'D15', 'digital', 'GPIO15 · ADC2 CH3, touch 3, HSPI CS — strapping pin'],
  ['GPIO8', 'SD1', 'nc', 'GPIO8 · wired to the onboard SPI flash — do not use'],
  ['GPIO7', 'SD0', 'nc', 'GPIO7 · wired to the onboard SPI flash — do not use'],
  ['GPIO6', 'CLK', 'nc', 'GPIO6 · wired to the onboard SPI flash — do not use'],
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
    }),
  );
}

function headerLabels(
  specs: readonly PinSpec[],
  x: number,
  anchor: 'start' | 'end',
): readonly Shape[] {
  return specs.map(([, label, type], index) =>
    text(x, HEADER_TOP + index * HEADER_PITCH + u(0.35), label, {
      size: u(0.85),
      // The flash pins are printed dimmer, the way a board that wants you to
      // leave them alone would print them.
      fill: type === 'nc' ? SILK.dim : SILK.white,
      anchor,
      weight: 600,
      mono: true,
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
    // Shield can, kept matte like the rest of the board.
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

    // AMS1117 regulator and the CP2102 USB-UART bridge, below the module.
    ...flatChip(u(10.6), u(29), u(5.3), u(3.2), 'AMS', u(0.75)),
    ...flatChip(u(11.6), u(33.5), u(5), u(5), 'CP2102', u(0.7)),

    // Power and user LEDs. The user LED follows GPIO2 while the sim runs.
    ...flatLed(u(12.4), u(40.5), WOKWI.ledRed),
    ...flatLed(u(15.9), u(40.5), onboardLedColor(context, WOKWI.ledBlue, WOKWI.ledBlueOff)),
    silkLabel(u(12.4), u(42.6), 'PWR', { size: u(0.7), detail: 'high' }),
    silkLabel(u(15.9), u(42.6), 'LED', { size: u(0.7), detail: 'high' }),

    silkLabel(WIDTH / 2, u(45.5), 'ESP32 DEVKIT V1', {
      size: u(1.05),
      weight: 600,
      detail: 'normal',
    }),

    // EN and BOOT flank the USB socket on the 38-pin layout, inboard of the
    // headers so a 6 mm cap never swallows a click meant for a pin.
    ...flatButton(u(7.7), u(49.5), u(5.2)),
    silkLabel(u(7.7), u(53.2), 'EN', { size: u(0.85), detail: 'normal' }),
    ...flatButton(WIDTH - u(7.7), u(49.5), u(5.2)),
    silkLabel(WIDTH - u(7.7), u(53.2), 'BOOT', { size: u(0.85), detail: 'normal' }),

    // Micro-USB, overhanging the bottom edge exactly as the socket does.
    ...flatUsbConnector(WIDTH / 2 - u(3.75), HEIGHT - u(4), u(7.5), u(5.5)),

    // Male header pins down both long edges.
    ...flatHeader(LEFT_HEADER_X, HEADER_TOP, PINS_PER_SIDE, 'vertical'),
    ...flatHeader(RIGHT_HEADER_X, HEADER_TOP, PINS_PER_SIDE, 'vertical'),

    // Silkscreen pin names, printed inboard of each header.
    // Half a header's width plus a gap, so names print beside the plastic, not on it.
    ...headerLabels(LEFT_HEADER, LEFT_HEADER_X + u(1.6), 'start'),
    ...headerLabels(RIGHT_HEADER, RIGHT_HEADER_X - u(1.6), 'end'),

    // Pin-1 marker, the square pad every board prints at the header origin.
    rect(LEFT_HEADER_X - u(1.5), HEADER_TOP - u(1.5), u(3), u(3), {
      rx: u(0.2),
      fill: 'none',
      stroke: SILK.soft,
      strokeWidth: u(0.12),
      opacity: 0.7,
      detail: 'high',
    }),
  ];
}

export const ESP32_DEVKIT_38: VirtualDevice = {
  defaultSpi: { mosi: 'GPIO23', miso: 'GPIO19', clock: 'GPIO18', select: 'GPIO5' },
  id: 'esp32-devkit-38',
  name: 'ESP32 DevKit 38-pin',
  model: 'DOIT ESP32 DevKit V1 (38-pin)',
  description:
    'ESP32-D0WDQ6 board breaking out all 38 header positions, including the six SPI-flash pins.',
  x: 80,
  y: 40,
  ...BODY,
  // The standalone canvas opens on this board, so it is the one part that
  // starts visible without the user placing it.
  initiallyVisible: true,
  printsOwnPinLabels: true,
  powerSource: true,
  logicVoltage: 3.3,
  maxLogicInputVoltage: 3.6,
  operatingVoltage: { min: 3, max: 12, recommended: 5 },
  interfaces: ['digital', 'analog', 'pwm', 'i2c', 'spi', 'uart', 'power'],
  // Nineteen holes at 2.54 mm leave no room for the 9.5-unit default without
  // neighbouring hit targets overlapping.
  pinHitRadius: 8,
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
    aliases: ['esp32 38', 'esp32 38 pin', 'devkitc', 'doit esp32 38', 'อีเอสพี32 38'],
    tags: ['esp32', 'wifi', 'bluetooth', 'microcontroller', 'board', '3V3', 'digital', 'analog'],
    interfaceLabel: 'ดิจิทัล / แอนะล็อก · 38 ขา',
    typicalUsage:
      'ESP32 projects that need every broken-out pin, or a board matching the 38-pin footprint.',
  },
};
