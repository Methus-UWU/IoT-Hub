import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import {
  chip,
  dipChip,
  femaleHeader,
  indicatorLed,
  mountingHole,
  silkLabel,
  usbConnector,
} from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, line, path, rect, text, type Shape } from '../core/device-shape';
import type { PinType } from '../core/device-types';

const WIDTH = 420;
const HEIGHT = 326;
const TOP_Y = 18;
const BOTTOM_Y = HEIGHT - 18;

/**
 * Header layout mirrors a real Uno viewed with the USB socket on the left:
 * the top edge carries SCL…8 then a gap then 7…0, and the bottom edge carries
 * the power header then the analog header.
 *
 * The board is too narrow for all 18 top pins at the standard 2.54 mm pitch once
 * the two groups are separated by a real gap, so this board packs its own header
 * pitch slightly tighter than {@link PIN_PITCH}. That keeps both groups on-board
 * with a visible gap between them and stops the printed pin names from colliding.
 */
const HDR_PITCH = 17;
const DIGITAL_HIGH_X = 98;
const DIGITAL_LOW_X = 274;
const POWER_X = 152;
const ANALOG_X = 294;

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
  ['TX1', 'TX→1', 'uart-tx', 'UART transmit, used by the USB bridge'],
  ['RX0', 'RX←0', 'uart-rx', 'UART receive, used by the USB bridge'],
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

function headerPins(specs: readonly PinSpec[], startX: number, y: number, side: 'top' | 'bottom') {
  return specs.map(([id, label, type, detail], index) =>
    pin(id, startX + index * HDR_PITCH, y, type, {
      side,
      description: detail,
      aliases: label === id ? undefined : [label],
      voltage: type !== 'vcc' ? undefined : id === '3V3' ? 3.3 : 5,
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
    text(startX + index * HDR_PITCH, y, label, {
      size: 7.5,
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
    // Accurate Uno outline: rounded left corners and chamfered USB-free edge.
    path('M10 0H394L420 26V302L396 326H10Q0 326 0 316V10Q0 0 10 0Z', {
      fill: '#2f739f',
      stroke: '#205778',
      strokeWidth: 2,
      strokeLinejoin: 'round',
    }),
    path('M12 3H392L416 27', {
      fill: 'none',
      stroke: '#5d95b9',
      strokeWidth: 1.2,
      opacity: 0.65,
    }),

    // Mounting holes in the Uno's asymmetric pattern.
    mountingHole(24, HEIGHT - 24),
    mountingHole(WIDTH - 22, 108),
    mountingHole(WIDTH - 22, HEIGHT - 44),

    // USB-B socket and barrel jack hang off the left edge.
    ...usbConnector(-24, 72, 82, 70, 'type-b'),
    rect(-16, 244, 68, 56, {
      rx: 6,
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: 1.25,
    }),
    rect(-24, 254, 28, 36, { rx: 3, fill: '#050607' }),

    // Red reset switch on its pale carrier, as on a physical Uno R3.
    rect(16, 18, 46, 42, { fill: '#d7d9dc', stroke: '#6f7780', strokeWidth: 1 }),
    circle(39, 39, 10, { fill: '#b51217', stroke: '#7d0c10', strokeWidth: 1 }),
    rect(9, 22, 7, 8, { fill: '#f4f5f6' }),
    rect(9, 35, 7, 8, { fill: '#f4f5f6' }),
    rect(9, 48, 7, 8, { fill: '#f4f5f6' }),

    // Female headers.
    ...femaleHeader(DIGITAL_HIGH_X, TOP_Y, DIGITAL_HIGH.length, 'horizontal', HDR_PITCH),
    ...femaleHeader(DIGITAL_LOW_X, TOP_Y, DIGITAL_LOW.length, 'horizontal', HDR_PITCH),
    ...femaleHeader(POWER_X, BOTTOM_Y, POWER.length, 'horizontal', HDR_PITCH),
    ...femaleHeader(ANALOG_X, BOTTOM_Y, ANALOG.length, 'horizontal', HDR_PITCH),

    // ATmega328P as a real DIP-28 (14 legs per side), plus the USB bridge.
    ...dipChip(170, 196, 220, 62, 14, 'ATMEGA328P'),
    ...chip(86, 74, 54, 40, '16U2', { labelSize: 8 }),

    // 16 MHz crystal.
    rect(150, 128, 20, 10, {
      rx: 10,
      fill: PART.crystal,
      stroke: PART.metalDark,
      strokeWidth: 1,
      detail: 'normal',
    }),

    // Status LEDs — L (pin 13), TX and RX by the ATmega, ON by the power rail.
    ...indicatorLed(150, 150, 'orange', live),
    ...indicatorLed(150, 168, 'green', live),
    ...indicatorLed(150, 186, 'yellow', live),
    ...indicatorLed(352, 146, 'green', true),
    rect(382, 58, 28, 46, { rx: 2, fill: '#666e75', stroke: '#394047', strokeWidth: 1 }),
    circle(390, 69, 3.6, { fill: '#b9bec3' }),
    circle(402, 69, 3.6, { fill: '#b9bec3' }),
    circle(390, 81, 3.6, { fill: '#b9bec3' }),
    circle(402, 81, 3.6, { fill: '#b9bec3' }),
    circle(390, 93, 3.6, { fill: '#b9bec3' }),
    circle(402, 93, 3.6, { fill: '#b9bec3' }),

    // Arduino infinity mark and Uno silkscreen.
    circle(205, 132, 19, { fill: 'none', stroke: SILK.white, strokeWidth: 5 }),
    circle(243, 132, 19, { fill: 'none', stroke: SILK.white, strokeWidth: 5 }),
    line(220, 120, 228, 144, { stroke: SILK.white, strokeWidth: 5, strokeLinecap: 'round' }),
    line(220, 144, 228, 120, { stroke: SILK.white, strokeWidth: 5, strokeLinecap: 'round' }),
    text(205, 137, '−', { size: 18, fill: SILK.white, anchor: 'middle', weight: 700 }),
    text(243, 138, '+', { size: 18, fill: SILK.white, anchor: 'middle', weight: 700 }),
    rect(274, 112, 70, 38, {
      rx: 7,
      fill: 'none',
      stroke: SILK.soft,
      strokeWidth: 1,
    }),
    text(309, 140, 'UNO', { size: 25, fill: SILK.white, anchor: 'middle', weight: 500 }),
    silkLabel(224, 170, 'ARDUINO', { size: 14, fill: SILK.white, weight: 700 }),
    silkLabel(245, 61, 'DIGITAL (PWM ~)', { size: 10, fill: SILK.white, anchor: 'middle' }),
    silkLabel(211, BOTTOM_Y - 36, 'POWER', { size: 10, fill: SILK.white, anchor: 'middle' }),
    silkLabel(336, BOTTOM_Y - 36, 'ANALOG IN', { size: 10, fill: SILK.white, anchor: 'middle' }),
    text(138, 154, 'L', { size: 8, fill: SILK.white, anchor: 'end', mono: true }),
    text(138, 172, 'TX', { size: 8, fill: SILK.white, anchor: 'end', mono: true }),
    text(138, 190, 'RX', { size: 8, fill: SILK.white, anchor: 'end', mono: true }),
    text(363, 150, 'ON', { size: 8, fill: SILK.white, anchor: 'start', mono: true }),

    // Pin names, rotated to run along the header like real silkscreen. The
    // anchor makes each name grow *away* from the holes (top names downward,
    // bottom names upward) so a long label never prints over its own pin.
    ...headerLabels(DIGITAL_HIGH, DIGITAL_HIGH_X, TOP_Y + 8, 'end'),
    ...headerLabels(DIGITAL_LOW, DIGITAL_LOW_X, TOP_Y + 8, 'end'),
    ...headerLabels(POWER, POWER_X, BOTTOM_Y - 8, 'start'),
    ...headerLabels(ANALOG, ANALOG_X, BOTTOM_Y - 8, 'start'),
  ];
}

/** Arduino Uno R3 — the reference 5 V ATmega328P development board. */
export const ARDUINO_UNO_R3: VirtualDevice = {
  id: 'arduino-uno-r3',
  name: 'Arduino Uno',
  model: 'Arduino Uno R3',
  description: 'ATmega328P board with 14 digital I/O, 6 analog inputs, and USB-B programming.',
  x: 60,
  y: 60,
  width: WIDTH,
  height: HEIGHT,
  initiallyVisible: false,
  // The board silkscreens every pin name, so the hover overlay is redundant.
  printsOwnPinLabels: true,
  // The 17-unit header pitch needs a sub-8-unit radius to prevent adjacent pins
  // from stealing pointer events from SCL/SDA and other neighbouring sockets.
  pinHitRadius: 7.5,
  operatingVoltage: { min: 7, max: 12, recommended: 5 },
  interfaces: ['digital', 'analog', 'pwm', 'i2c', 'spi', 'uart', 'power'],
  pins: [
    ...headerPins(DIGITAL_HIGH, DIGITAL_HIGH_X, TOP_Y, 'top'),
    ...headerPins(DIGITAL_LOW, DIGITAL_LOW_X, TOP_Y, 'top'),
    ...headerPins(POWER, POWER_X, BOTTOM_Y, 'bottom'),
    ...headerPins(ANALOG, ANALOG_X, BOTTOM_Y, 'bottom'),
  ],
  render: { draw, bleed: { left: 24 } },
  catalog: {
    categoryId: 'microcontrollers',
    category: 'Microcontrollers',
    aliases: ['uno', 'arduino uno', 'atmega328', 'อาร์ดูอิโน่'],
    tags: ['arduino', 'uno', 'atmega328p', 'microcontroller', 'board', '5V', 'digital', 'analog'],
    interfaceLabel: 'ดิจิทัล / แอนะล็อก · 32 ขา',
    typicalUsage: 'Teaching, prototyping, and shield-based projects that need 5 V logic.',
  },
};
