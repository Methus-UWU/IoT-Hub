import type { OnboardLed, VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { WOKWI } from '../core/device-palette';
import { flatHeader, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, rect, text, type Shape } from '../core/device-shape';
import type { PinType } from '../core/device-types';
import { createBoardBehavior, AVR_RUNTIME, onboardLedColor } from './board-behavior';

/**
 * Arduino Nano — an Uno's ATmega328P on an 18 × 45 mm strip.
 *
 * Drawn with the USB socket at the top, which is the orientation every Nano
 * pinout diagram uses and therefore the one a user is holding in their head
 * while they wire it. Both 15-way headers run the full length of the long
 * edges, 0.6 in apart, so the part straddles the centre channel of a breadboard
 * exactly as the hardware does.
 *
 * A0-A5 are ordinary ADC channels; A6 and A7 exist only on the surface-mount
 * package and are analog *input only*, which their descriptions say because
 * nothing else on the board hints at it.
 */

const BODY = bodyFromMm({ widthMm: 18, heightMm: 45 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

/** Header rows sit 0.6 in apart — the width a DIP-28 straddles. */
const LEFT_HEADER_X = (WIDTH - u(15.24)) / 2;
const RIGHT_HEADER_X = WIDTH - LEFT_HEADER_X;
const HEADER_TOP = u(5.2);

type PinSpec = readonly [id: string, label: string, type: PinType, detail: string];

/** Left header, USB uppermost. */
const LEFT_HEADER: readonly PinSpec[] = [
  ['D13', 'D13', 'digital', 'D13 · SPI SCK, wired to the onboard L LED'],
  ['3V3', '3V3', 'vcc', '3.3 V from the USB bridge, 50 mA maximum'],
  ['AREF', 'REF', 'analog', 'External ADC reference voltage'],
  ['A0', 'A0', 'analog', 'A0 · ADC channel 0'],
  ['A1', 'A1', 'analog', 'A1 · ADC channel 1'],
  ['A2', 'A2', 'analog', 'A2 · ADC channel 2'],
  ['A3', 'A3', 'analog', 'A3 · ADC channel 3'],
  ['A4', 'A4', 'i2c-sda', 'A4 · ADC channel 4, doubles as I2C SDA'],
  ['A5', 'A5', 'i2c-scl', 'A5 · ADC channel 5, doubles as I2C SCL'],
  ['A6', 'A6', 'analog', 'A6 · ADC channel 6, analog input only — cannot drive anything'],
  ['A7', 'A7', 'analog', 'A7 · ADC channel 7, analog input only — cannot drive anything'],
  ['5V', '5V', 'vcc', 'Regulated 5 V output, or 5 V in when powered over USB'],
  ['RST-L', 'RST', 'reset', 'Reset, active low'],
  ['GND-L', 'GND', 'gnd', 'Ground reference'],
  ['VIN', 'VIN', 'vcc', 'Unregulated input, 7 - 12 V through the onboard regulator'],
];

/** Right header, USB uppermost. */
const RIGHT_HEADER: readonly PinSpec[] = [
  ['D12', 'D12', 'digital', 'D12 · SPI MISO'],
  ['D11', 'D11', 'pwm', 'D11 · SPI MOSI, PWM'],
  ['D10', 'D10', 'pwm', 'D10 · SPI CS, PWM'],
  ['D9', 'D9', 'pwm', 'D9 · PWM'],
  ['D8', 'D8', 'digital', 'D8 · general purpose digital'],
  ['D7', 'D7', 'digital', 'D7 · general purpose digital'],
  ['D6', 'D6', 'pwm', 'D6 · PWM'],
  ['D5', 'D5', 'pwm', 'D5 · PWM'],
  ['D4', 'D4', 'digital', 'D4 · general purpose digital'],
  ['D3', 'D3', 'pwm', 'D3 · PWM, external interrupt 1'],
  ['D2', 'D2', 'digital', 'D2 · external interrupt 0'],
  ['GND-R', 'GND', 'gnd', 'Ground reference'],
  ['RST-R', 'RST', 'reset', 'Reset, active low'],
  ['D0', 'RX0', 'uart-rx', 'D0 · UART RX, shared with the USB bridge'],
  ['D1', 'TX1', 'uart-tx', 'D1 · UART TX, shared with the USB bridge'],
];

/** The board's user LED: what `LED_BUILTIN` names, and what the artwork lights. */
const ONBOARD_LED: OnboardLed = { pin: 'D13', label: 'L' };

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
    text(x, HEADER_TOP + index * HEADER_PITCH + u(0.3), label, {
      size: u(0.82),
      fill: WOKWI.label,
      anchor,
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
  );
}

function flatLed(cx: number, cy: number, fill: string): readonly Shape[] {
  return [
    circle(cx, cy, u(0.6), { fill: WOKWI.espBoardEdge }),
    circle(cx, cy, u(0.4), {
      fill,
      stroke: WOKWI.buttonEdge,
      strokeWidth: u(0.07),
    }),
  ];
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const live = context.running;

  return [
    // PCB.
    rect(0, 0, WIDTH, HEIGHT, {
      rx: u(0.8),
      fill: WOKWI.espBoard,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.2),
    }),
    rect(u(0.3), u(0.3), WIDTH - u(0.6), HEIGHT - u(0.6), {
      rx: u(0.6),
      fill: 'none',
      stroke: WOKWI.espBoardTrace,
      strokeWidth: u(0.1),
      opacity: 0.7,
      detail: 'normal',
    }),

    // Mini-USB shell, overhanging the top edge the way the socket does.
    rect(WIDTH / 2 - u(3.85), -u(1.2), u(7.7), u(5.6), {
      rx: u(0.35),
      fill: WOKWI.usb,
      stroke: WOKWI.shieldEdge,
      strokeWidth: u(0.15),
    }),
    rect(WIDTH / 2 - u(2.9), -u(0.5), u(5.8), u(3.4), {
      rx: u(0.2),
      fill: WOKWI.usbInset,
    }),

    // CH340 / FT232 bridge, immediately below the socket.
    rect(u(5.4), u(6.4), u(7.2), u(4.4), {
      rx: u(0.25),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.12),
    }),
    silkLabel(WIDTH / 2, u(9), 'CH340', {
      size: u(0.72),
      fill: WOKWI.label,
      detail: 'high',
    }),

    // Status LEDs in one row below the bridge. The strips beside the headers
    // belong to the pin names, so nothing else is placed there.
    ...flatLed(u(5.6), u(12.2), live ? WOKWI.ledRed : WOKWI.ledRedOff),
    // L, which follows D13.
    ...flatLed(u(7.6), u(12.2), onboardLedColor(context, WOKWI.ledBlue, WOKWI.ledBlueOff)),
    ...flatLed(u(10.4), u(12.2), WOKWI.ledRedOff),
    ...flatLed(u(12.4), u(12.2), WOKWI.ledRedOff),
    silkLabel(u(6.6), u(14), 'PWR', {
      size: u(0.6),
      fill: WOKWI.espBoardTrace,
      detail: 'high',
    }),
    silkLabel(u(11.4), u(14), 'TX/RX', {
      size: u(0.6),
      fill: WOKWI.espBoardTrace,
      detail: 'high',
    }),

    // Reset button, centred under the LEDs.
    rect(u(7.4), u(15.2), u(3.2), u(3.2), {
      rx: u(0.28),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.12),
    }),
    circle(u(9), u(16.8), u(1), {
      fill: WOKWI.button,
      stroke: WOKWI.buttonEdge,
      strokeWidth: u(0.12),
    }),

    // ATmega328P in its TQFP-32 package, centred on the board.
    rect(u(4.6), u(19), u(8.8), u(8.8), {
      rx: u(0.3),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.14),
    }),
    circle(u(5.7), u(20.1), u(0.5), {
      fill: WOKWI.chipInset,
      detail: 'normal',
    }),
    silkLabel(WIDTH / 2, u(23.2), 'ATMEGA', {
      size: u(0.78),
      fill: WOKWI.label,
      detail: 'normal',
    }),
    silkLabel(WIDTH / 2, u(24.9), '328P', {
      size: u(0.78),
      fill: WOKWI.label,
      detail: 'normal',
    }),

    // 16 MHz crystal beside the MCU.
    rect(u(5.2), u(29.2), u(7.6), u(2.6), {
      rx: u(1.3),
      fill: WOKWI.shield,
      stroke: WOKWI.shieldEdge,
      strokeWidth: u(0.12),
      detail: 'normal',
    }),

    // ICSP header, 2 x 3 at the far end from the USB socket.
    rect(u(6.1), u(33.4), u(5.8), u(3.6), {
      rx: u(0.25),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.1),
      detail: 'normal',
    }),
    ...[0, 1, 2].flatMap((column) =>
      [0, 1].map((row) =>
        rect(u(6.7) + column * u(1.7), u(34) + row * u(1.7), u(0.9), u(0.9), {
          rx: u(0.12),
          fill: WOKWI.gold,
          detail: 'high',
        }),
      ),
    ),

    silkLabel(WIDTH / 2, u(39.8), 'NANO', {
      size: u(1.05),
      weight: 700,
      detail: 'normal',
    }),

    // Male header pins down both long edges.
    ...flatHeader(LEFT_HEADER_X, HEADER_TOP, LEFT_HEADER.length, 'vertical'),
    ...flatHeader(RIGHT_HEADER_X, HEADER_TOP, RIGHT_HEADER.length, 'vertical'),
    // Half a header's width plus a gap, so names print beside the plastic, not on it.
    ...headerLabels(LEFT_HEADER, LEFT_HEADER_X + u(1.6), 'start'),
    ...headerLabels(RIGHT_HEADER, RIGHT_HEADER_X - u(1.6), 'end'),
  ];
}

export const ARDUINO_NANO: VirtualDevice = {
  defaultSpi: { mosi: 'D11', miso: 'D12', clock: 'D13', select: 'D10' },
  id: 'arduino-nano',
  name: 'Arduino Nano',
  model: 'Arduino Nano (ATmega328P)',
  description: "An Uno's processor on a breadboard-width strip, with 8 analog inputs.",
  x: 80,
  y: 60,
  ...BODY,
  initiallyVisible: false,
  printsOwnPinLabels: true,
  powerSource: true,
  logicVoltage: 5,
  maxLogicInputVoltage: 5.5,
  operatingVoltage: { min: 5, max: 12, recommended: 5 },
  interfaces: ['digital', 'analog', 'pwm', 'i2c', 'spi', 'uart', 'power'],
  pins: [
    ...headerPins(LEFT_HEADER, LEFT_HEADER_X, 'left'),
    ...headerPins(RIGHT_HEADER, RIGHT_HEADER_X, 'right'),
  ],
  render: { draw, bleed: { top: u(1.5) } },
  onboardLed: ONBOARD_LED,
  simulation: (instanceId) => createBoardBehavior(instanceId, AVR_RUNTIME, ONBOARD_LED),
  catalog: {
    categoryId: 'microcontrollers',
    category: 'Microcontrollers',
    aliases: ['nano', 'arduino nano', 'atmega328', 'อาร์ดูโน่ นาโน'],
    tags: ['arduino', 'nano', 'atmega328p', 'microcontroller', 'board', '5V', 'breadboard'],
    interfaceLabel: 'ดิจิทัล / แอนะล็อก · 30 ขา',
    typicalUsage: 'Breadboard projects that want Uno compatibility in a fraction of the space.',
  },
};
