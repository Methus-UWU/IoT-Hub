import type { OnboardLed, VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { LED_COLORS, SILK, WOKWI } from '../core/device-palette';
import {
  flatButton,
  flatChip,
  flatDipChip,
  flatHeader,
  flatLed,
  flatMountingHole,
  flatUsbConnector,
  silkLabel,
} from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, line, path, rect, repeat, text, type Shape } from '../core/device-shape';
import type { PinType } from '../core/device-types';
import { createBoardBehavior, AVR_RUNTIME, onboardLedColor } from './board-behavior';

/**
 * Arduino Uno R3 — the reference 5 V ATmega328P board.
 *
 * Drawn with the USB socket on the left, which is how the board is normally
 * photographed and how its silkscreen reads: digital pins along the top edge,
 * power and analog along the bottom.
 *
 * The header pitch is exactly 2.54 mm, and the 4.06 mm gap between D7 and D8 is
 * reproduced because it is the single most consequential dimension on the
 * board — it is the misalignment every Uno shield has to accommodate. The
 * offsets of each header group from the left edge are drawn to look right rather
 * than claimed as datasheet figures; nothing in this app mounts a shield, so
 * their exact value carries no meaning that the pitch does not already carry.
 */

const BODY = bodyFromMm({ widthMm: 68.6, heightMm: 53.4 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

/** Header centre-lines, one header width in from each long edge. */
const TOP_Y = u(2.5);
const BOTTOM_Y = HEIGHT - u(2.5);

const DIGITAL_HIGH_X = u(21.3);
/** D7 sits 4.06 mm from D8 — the Uno's famous off-pitch gap. */
const DIGITAL_LOW_X = DIGITAL_HIGH_X + 9 * HEADER_PITCH + u(4.06);
const POWER_X = u(15.2);
const ANALOG_X = u(38.1);

/**
 * Pin id and silkscreen label are separate: a real Uno prints "GND" on three
 * different holes, but wires need to name exactly one of them, so ids stay
 * unique while the board still reads correctly.
 */
type PinSpec = readonly [id: string, label: string, type: PinType, detail: string];

const DIGITAL_HIGH: readonly PinSpec[] = [
  ['SCL', 'SCL', 'i2c-scl', 'I2C clock, shared with A5'],
  ['SDA', 'SDA', 'i2c-sda', 'I2C data, shared with A4'],
  ['AREF', 'AREF', 'analog', 'Analog reference voltage'],
  ['GND-D', 'GND', 'gnd', 'Ground reference, digital header'],
  ['13', '13', 'digital', 'SPI SCK, drives the onboard L LED'],
  ['12', '12', 'digital', 'SPI MISO'],
  ['11', '~11', 'pwm', 'SPI MOSI, PWM capable'],
  ['10', '~10', 'pwm', 'SPI SS, PWM capable'],
  ['9', '~9', 'pwm', 'PWM capable'],
  ['8', '8', 'digital', 'General purpose digital I/O'],
];

const DIGITAL_LOW: readonly PinSpec[] = [
  ['7', '7', 'digital', 'General purpose digital I/O'],
  ['6', '~6', 'pwm', 'PWM capable'],
  ['5', '~5', 'pwm', 'PWM capable'],
  ['4', '4', 'digital', 'General purpose digital I/O'],
  ['3', '~3', 'pwm', 'PWM capable, external interrupt 1'],
  ['2', '2', 'digital', 'External interrupt 0'],
  ['TX1', 'TX1', 'uart-tx', 'UART transmit, used by the USB bridge'],
  ['RX0', 'RX0', 'uart-rx', 'UART receive, used by the USB bridge'],
];

const POWER: readonly PinSpec[] = [
  ['NC', 'NC', 'nc', 'Not connected'],
  ['IOREF', 'IOREF', 'vcc', 'Logic level reference, 5 V on an Uno'],
  ['RESET', 'RESET', 'reset', 'Active-low reset'],
  ['3V3', '3V3', 'vcc', 'Regulated 3.3 V, 50 mA maximum'],
  ['5V', '5V', 'vcc', 'Regulated 5 V supply'],
  ['GND-P1', 'GND', 'gnd', 'Ground reference, power header'],
  ['GND-P2', 'GND', 'gnd', 'Ground reference, power header'],
  ['VIN', 'VIN', 'vcc', 'Unregulated supply input, 7–12 V'],
];

const ANALOG: readonly PinSpec[] = [
  ['A0', 'A0', 'analog', '10-bit ADC channel 0'],
  ['A1', 'A1', 'analog', '10-bit ADC channel 1'],
  ['A2', 'A2', 'analog', '10-bit ADC channel 2'],
  ['A3', 'A3', 'analog', '10-bit ADC channel 3'],
  ['A4', 'A4', 'analog', 'ADC channel 4, doubles as I2C SDA'],
  ['A5', 'A5', 'analog', 'ADC channel 5, doubles as I2C SCL'],
];

/** The board's user LED: what `LED_BUILTIN` names, and what the artwork lights. */
const ONBOARD_LED: OnboardLed = { pin: '13', label: 'L' };

function headerPins(specs: readonly PinSpec[], startX: number, y: number, side: 'top' | 'bottom') {
  return specs.map(([id, label, type, detail], index) =>
    pin(id, startX + index * HEADER_PITCH, y, type, {
      side,
      description: detail,
      aliases: label === id ? undefined : [label],
      voltage: type !== 'vcc' ? undefined : id === '3V3' ? 3.3 : 5,
      maxCurrentMa: id === '3V3' ? 50 : id === '5V' ? 500 : undefined,
    }),
  );
}

function headerLabels(
  specs: readonly PinSpec[],
  startX: number,
  y: number,
  anchor: 'start' | 'end',
): readonly Shape[] {
  return specs.map(([, label], index) =>
    text(startX + index * HEADER_PITCH, y, label, {
      size: u(0.95),
      fill: SILK.white,
      anchor,
      weight: 600,
      mono: true,
      rotate: -90,
      detail: 'normal',
    }),
  );
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const live = context.running;

  return [
    // The Uno silhouette: rounded left corners, chamfered top-right, and the
    // stepped notch on the right edge that clears a shield's USB connector.
    path(
      `M ${u(1)} 0 H ${u(64)} L ${WIDTH} ${u(2.6)} V ${u(50.8)} L ${u(66)} ${HEIGHT} ` +
        `H ${u(1)} Q 0 ${HEIGHT} 0 ${u(52.4)} V ${u(1)} Q 0 0 ${u(1)} 0 Z`,
      {
        fill: WOKWI.arduinoBoard,
        stroke: WOKWI.arduinoBoardEdge,
        strokeWidth: u(0.2),
        strokeLinejoin: 'round',
      },
    ),
    // Inset trace following the same silhouette, as on the Mega and the Nano.
    path(
      `M ${u(1.2)} ${u(0.35)} H ${u(63.85)} L ${WIDTH - u(0.35)} ${u(2.75)} ` +
        `V ${u(50.65)} L ${u(65.85)} ${HEIGHT - u(0.35)} H ${u(1.2)} ` +
        `Q ${u(0.35)} ${HEIGHT - u(0.35)} ${u(0.35)} ${u(52.2)} V ${u(1.2)} ` +
        `Q ${u(0.35)} ${u(0.35)} ${u(1.2)} ${u(0.35)} Z`,
      {
        fill: 'none',
        stroke: WOKWI.arduinoBoardTrace,
        strokeWidth: u(0.1),
        opacity: 0.7,
        detail: 'normal',
      },
    ),

    // Mounting holes in the Uno's asymmetric M3 pattern.
    flatMountingHole(u(2.5), HEIGHT - u(2.5)),
    flatMountingHole(WIDTH - u(2.5), u(17)),
    flatMountingHole(WIDTH - u(2.5), HEIGHT - u(4.5)),
    flatMountingHole(u(57), HEIGHT - u(2.5)),

    // USB-B socket and barrel jack, both overhanging the left edge.
    ...flatUsbConnector(-u(3), u(11), u(16), u(12)),
    rect(-u(2.5), u(33), u(13), u(11), {
      rx: u(0.6),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.2),
    }),
    rect(-u(3), u(34), u(3), u(9), { rx: u(0.3), fill: WOKWI.socket, detail: 'normal' }),

    // Red reset cap, as on a physical Uno R3.
    ...flatButton(u(16.5), u(6.4), u(6), { cap: '#b51217', capEdge: '#7d0c10' }),

    // Female headers.
    ...flatHeader(DIGITAL_HIGH_X, TOP_Y, DIGITAL_HIGH.length),
    ...flatHeader(DIGITAL_LOW_X, TOP_Y, DIGITAL_LOW.length),
    ...flatHeader(POWER_X, BOTTOM_Y, POWER.length),
    ...flatHeader(ANALOG_X, BOTTOM_Y, ANALOG.length),

    // ATmega328P as a real DIP-28: 34.7 mm long, 7.5 mm across the package.
    ...flatDipChip(u(23), u(34), u(34.7), u(7.5), 14, 'ATMEGA328P', u(1.4)),
    // ATmega16U2 USB bridge, a 5 mm QFN.
    ...flatChip(u(15.5), u(13), u(5), u(5), '16U2', u(0.75)),

    // 16 MHz crystal.
    rect(u(33), u(25), u(11), u(4), {
      rx: u(2),
      fill: WOKWI.shield,
      stroke: WOKWI.shieldEdge,
      strokeWidth: u(0.12),
      detail: 'normal',
    }),

    // ICSP header for the main MCU, right edge.
    ...repeat(
      3,
      { x: HEADER_PITCH },
      (_, holeX) => [
        circle(holeX, u(10), u(0.8), { fill: WOKWI.gold, detail: 'normal' }),
        circle(holeX, u(12.5), u(0.8), { fill: WOKWI.gold, detail: 'normal' }),
      ],
      { x: u(60) },
    ),

    // Status LEDs — L (pin 13), TX and RX beside the bridge, ON by the power
    // rail. Kept clear of the 16U2 and the UNO frame so neither label is covered.
    ...flatLed(
      u(23),
      u(16),
      onboardLedColor(context, LED_COLORS.orange.on, LED_COLORS.orange.off),
      u(0.6),
    ),
    ...flatLed(u(23), u(18.5), live ? LED_COLORS.green.on : LED_COLORS.green.off, u(0.6)),
    ...flatLed(u(23), u(21), live ? LED_COLORS.yellow.on : LED_COLORS.yellow.off, u(0.6)),
    ...flatLed(u(54.5), u(20), LED_COLORS.green.on, u(0.6)),
    text(u(21.8), u(16.4), 'L', {
      size: u(0.85),
      fill: SILK.white,
      anchor: 'end',
      mono: true,
      detail: 'high',
    }),
    text(u(21.8), u(18.9), 'TX', {
      size: u(0.85),
      fill: SILK.white,
      anchor: 'end',
      mono: true,
      detail: 'high',
    }),
    text(u(21.8), u(21.4), 'RX', {
      size: u(0.85),
      fill: SILK.white,
      anchor: 'end',
      mono: true,
      detail: 'high',
    }),
    text(u(56.1), u(20.4), 'ON', {
      size: u(0.85),
      fill: SILK.white,
      anchor: 'start',
      mono: true,
      detail: 'high',
    }),

    // Arduino infinity mark. Original geometry — two rings crossed by an X —
    // drawn from primitives rather than traced from anyone's artwork.
    circle(u(28), u(19), u(2.2), { fill: 'none', stroke: SILK.white, strokeWidth: u(0.55) }),
    circle(u(32.4), u(19), u(2.2), { fill: 'none', stroke: SILK.white, strokeWidth: u(0.55) }),
    line(u(29.6), u(17.6), u(30.8), u(20.4), {
      stroke: SILK.white,
      strokeWidth: u(0.55),
      strokeLinecap: 'round',
    }),
    line(u(29.6), u(20.4), u(30.8), u(17.6), {
      stroke: SILK.white,
      strokeWidth: u(0.55),
      strokeLinecap: 'round',
    }),
    text(u(28), u(19.7), '−', { size: u(2), fill: SILK.white, anchor: 'middle', weight: 700 }),
    text(u(32.4), u(19.8), '+', { size: u(2), fill: SILK.white, anchor: 'middle', weight: 700 }),
    silkLabel(u(30.2), u(24), 'ARDUINO', { size: u(1.8), weight: 700 }),

    rect(u(41), u(16), u(11), u(6.4), {
      rx: u(1),
      fill: 'none',
      stroke: SILK.soft,
      strokeWidth: u(0.12),
      detail: 'normal',
    }),
    text(u(46.5), u(21), 'UNO', { size: u(3.4), fill: SILK.white, anchor: 'middle', weight: 500 }),

    // Below the longest rotated pin name, so the two never print over each other.
    silkLabel(u(37), u(8.4), 'DIGITAL (PWM ~)', { size: u(1.1) }),
    silkLabel(u(24), HEIGHT - u(6.6), 'POWER', { size: u(1.1) }),
    silkLabel(u(44.5), HEIGHT - u(6.6), 'ANALOG IN', { size: u(1.1) }),

    // Pin names, rotated to run along the header like real silkscreen. The
    // anchor makes each name grow *away* from the holes (top names downward,
    // bottom names upward) so a long label never prints over its own pin.
    ...headerLabels(DIGITAL_HIGH, DIGITAL_HIGH_X, TOP_Y + u(1.6), 'end'),
    ...headerLabels(DIGITAL_LOW, DIGITAL_LOW_X, TOP_Y + u(1.6), 'end'),
    ...headerLabels(POWER, POWER_X, BOTTOM_Y - u(1.6), 'start'),
    ...headerLabels(ANALOG, ANALOG_X, BOTTOM_Y - u(1.6), 'start'),
  ];
}

export const ARDUINO_UNO_R3: VirtualDevice = {
  defaultSpi: { mosi: '11', miso: '12', clock: '13', select: '10' },
  id: 'arduino-uno-r3',
  name: 'Arduino Uno',
  model: 'Arduino Uno R3',
  description: 'ATmega328P board with 14 digital I/O, 6 analog inputs, and USB-B programming.',
  x: 60,
  y: 60,
  ...BODY,
  initiallyVisible: false,
  // The board silkscreens every pin name, so the hover overlay is redundant.
  printsOwnPinLabels: true,
  powerSource: true,
  logicVoltage: 5,
  maxLogicInputVoltage: 5.5,
  operatingVoltage: { min: 7, max: 12, recommended: 5 },
  interfaces: ['digital', 'analog', 'pwm', 'i2c', 'spi', 'uart', 'power'],
  pins: [
    ...headerPins(DIGITAL_HIGH, DIGITAL_HIGH_X, TOP_Y, 'top'),
    ...headerPins(DIGITAL_LOW, DIGITAL_LOW_X, TOP_Y, 'top'),
    ...headerPins(POWER, POWER_X, BOTTOM_Y, 'bottom'),
    ...headerPins(ANALOG, ANALOG_X, BOTTOM_Y, 'bottom'),
  ],
  render: { draw, bleed: { left: u(3) } },
  onboardLed: ONBOARD_LED,
  simulation: (instanceId) => createBoardBehavior(instanceId, AVR_RUNTIME, ONBOARD_LED),
  catalog: {
    categoryId: 'microcontrollers',
    category: 'Microcontrollers',
    aliases: ['uno', 'arduino uno', 'atmega328', 'อาร์ดูอิโน่'],
    tags: ['arduino', 'uno', 'atmega328p', 'microcontroller', 'board', '5V', 'digital', 'analog'],
    interfaceLabel: 'ดิจิทัล / แอนะล็อก · 32 ขา',
    typicalUsage: 'Teaching, prototyping, and shield-based projects that need 5 V logic.',
  },
};
