import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { OUTLINE, PART, SILK } from '../core/device-palette';
import {
  chip,
  dipChip,
  femaleHeader,
  indicatorLed,
  mountingHole,
  silkLabel,
  tactileButton,
  usbConnector,
} from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, line, path, rect, repeat, text, type Shape } from '../core/device-shape';
import type { PinType } from '../core/device-types';

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

function headerPins(specs: readonly PinSpec[], startX: number, y: number, side: 'top' | 'bottom') {
  return specs.map(([id, label, type, detail], index) =>
    pin(id, startX + index * HEADER_PITCH, y, type, {
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
        fill: '#2f739f',
        stroke: '#205778',
        strokeWidth: u(0.2),
        strokeLinejoin: 'round',
      },
    ),
    path(`M ${u(1.4)} ${u(0.35)} H ${u(63.6)} L ${u(67.7)} ${u(2.9)}`, {
      fill: 'none',
      stroke: '#5d95b9',
      strokeWidth: u(0.12),
      opacity: 0.65,
      detail: 'normal',
    }),

    // Mounting holes in the Uno's asymmetric M3 pattern.
    mountingHole(u(2.5), HEIGHT - u(2.5)),
    mountingHole(WIDTH - u(2.5), u(17)),
    mountingHole(WIDTH - u(2.5), HEIGHT - u(4.5)),
    mountingHole(u(33.5), HEIGHT - u(2.5)),

    // USB-B socket and barrel jack, both overhanging the left edge.
    ...usbConnector(-u(3), u(11), u(16), u(12), 'type-b'),
    rect(-u(2.5), u(33), u(13), u(11), {
      rx: u(0.6),
      fill: PART.plasticBlack,
      stroke: OUTLINE,
      strokeWidth: u(0.13),
    }),
    rect(-u(3), u(34), u(3), u(9), { rx: u(0.3), fill: '#050607', detail: 'normal' }),

    // Red reset switch on its pale carrier, as on a physical Uno R3.
    ...tactileButton(u(16.5), u(6.4), u(6)),
    circle(u(16.5), u(6.4), u(1.8), {
      fill: '#b51217',
      stroke: '#7d0c10',
      strokeWidth: u(0.1),
    }),

    // Female headers.
    ...femaleHeader(DIGITAL_HIGH_X, TOP_Y, DIGITAL_HIGH.length, 'horizontal'),
    ...femaleHeader(DIGITAL_LOW_X, TOP_Y, DIGITAL_LOW.length, 'horizontal'),
    ...femaleHeader(POWER_X, BOTTOM_Y, POWER.length, 'horizontal'),
    ...femaleHeader(ANALOG_X, BOTTOM_Y, ANALOG.length, 'horizontal'),

    // ATmega328P as a real DIP-28: 34.7 mm long, 7.5 mm across the package.
    ...dipChip(u(23), u(34), u(34.7), u(7.5), 14, 'ATMEGA328P', { labelSize: u(1.4) }),
    // ATmega16U2 USB bridge, a 5 mm QFN.
    ...chip(u(15.5), u(13), u(5), u(5), '16U2', { labelSize: u(0.75) }),

    // 16 MHz crystal.
    rect(u(33), u(25), u(11), u(4), {
      rx: u(2),
      fill: PART.crystal,
      stroke: PART.metalDark,
      strokeWidth: u(0.12),
      detail: 'normal',
    }),

    // ICSP header for the main MCU, right edge.
    ...repeat(
      3,
      { x: HEADER_PITCH },
      (_, holeX) => [
        circle(holeX, u(10), u(0.8), { fill: PART.headerGold, detail: 'normal' }),
        circle(holeX, u(12.5), u(0.8), { fill: PART.headerGold, detail: 'normal' }),
      ],
      { x: u(60) },
    ),

    // Status LEDs — L (pin 13), TX and RX by the bridge, ON by the power rail.
    ...indicatorLed(u(19), u(16), 'orange', live),
    ...indicatorLed(u(19), u(18.5), 'green', live),
    ...indicatorLed(u(19), u(21), 'yellow', live),
    ...indicatorLed(u(52), u(20), 'green', true),
    text(u(17.6), u(16.4), 'L', { size: u(0.85), fill: SILK.white, anchor: 'end', mono: true, detail: 'high' }),
    text(u(17.6), u(18.9), 'TX', { size: u(0.85), fill: SILK.white, anchor: 'end', mono: true, detail: 'high' }),
    text(u(17.6), u(21.4), 'RX', { size: u(0.85), fill: SILK.white, anchor: 'end', mono: true, detail: 'high' }),
    text(u(53.6), u(20.4), 'ON', { size: u(0.85), fill: SILK.white, anchor: 'start', mono: true, detail: 'high' }),

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

    silkLabel(u(37), u(6.2), 'DIGITAL (PWM ~)', { size: u(1.1) }),
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
  operatingVoltage: { min: 7, max: 12, recommended: 5 },
  interfaces: ['digital', 'analog', 'pwm', 'i2c', 'spi', 'uart', 'power'],
  pins: [
    ...headerPins(DIGITAL_HIGH, DIGITAL_HIGH_X, TOP_Y, 'top'),
    ...headerPins(DIGITAL_LOW, DIGITAL_LOW_X, TOP_Y, 'top'),
    ...headerPins(POWER, POWER_X, BOTTOM_Y, 'bottom'),
    ...headerPins(ANALOG, ANALOG_X, BOTTOM_Y, 'bottom'),
  ],
  render: { draw, bleed: { left: u(3) } },
  catalog: {
    categoryId: 'microcontrollers',
    category: 'Microcontrollers',
    aliases: ['uno', 'arduino uno', 'atmega328', 'อาร์ดูอิโน่'],
    tags: ['arduino', 'uno', 'atmega328p', 'microcontroller', 'board', '5V', 'digital', 'analog'],
    interfaceLabel: 'ดิจิทัล / แอนะล็อก · 32 ขา',
    typicalUsage: 'Teaching, prototyping, and shield-based projects that need 5 V logic.',
  },
};
