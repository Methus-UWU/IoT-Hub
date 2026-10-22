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
 * Arduino Mega 2560 R3 — 101.5 × 53.3 mm, and the reason the shared millimetre
 * scale earns its keep: beside an Uno it is visibly twice the board, which is
 * the fact a user is weighing when they pick one.
 *
 * Four header groups, laid out as the hardware lays them out: the digital and
 * communication rows along the top edge, power and the sixteen analog inputs
 * along the bottom, and the 2 × 18 block of D22-D53 standing at the far end
 * from the USB socket. That last block is the Mega — it is where the extra
 * thirty-two pins live, and it is drawn as two columns because that is how a
 * user counts along it with a jumper in hand.
 *
 * Header *gaps* are reproduced too, including the famous 0.05 in offset between
 * the two top blocks. It is not decoration: it is why a shield fits one way
 * round only.
 */

const BODY = bodyFromMm({ widthMm: 101.52, heightMm: 53.3 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

const TOP_ROW_Y = u(2.6);
const BOTTOM_ROW_Y = HEIGHT - u(2.6);

/** Top edge: SCL/SDA/AREF/GND then D13-D8, and the offset block D7-D0. */
const TOP_LEFT_X = u(31.2);
const TOP_RIGHT_X = u(58.1);

/** Bottom edge: the power block, then A0-A7 and A8-A15. */
const POWER_X = u(19.3);
const ANALOG_LOW_X = u(41.2);
const ANALOG_HIGH_X = u(62.1);

/** The 2 x 18 block at the far end, two columns one tenth of an inch apart. */
const BLOCK_INNER_X = WIDTH - u(6.6);
const BLOCK_OUTER_X = WIDTH - u(4.06);
const BLOCK_TOP = u(7.4);

type PinSpec = readonly [id: string, label: string, type: PinType, detail: string];

/** Top edge, left block: I2C, the ADC reference, ground, and D13 down to D8. */
const TOP_LEFT: readonly PinSpec[] = [
  ['D21', 'SCL', 'i2c-scl', 'D21 · I2C SCL'],
  ['D20', 'SDA', 'i2c-sda', 'D20 · I2C SDA'],
  ['AREF', 'REF', 'analog', 'External ADC reference voltage'],
  ['GND-T', 'GND', 'gnd', 'Ground reference'],
  ['D13', '13', 'pwm', 'D13 · PWM, wired to the onboard L LED'],
  ['D12', '12', 'pwm', 'D12 · PWM'],
  ['D11', '11', 'pwm', 'D11 · PWM'],
  ['D10', '10', 'pwm', 'D10 · PWM, SPI CS on shields'],
  ['D9', '9', 'pwm', 'D9 · PWM'],
  ['D8', '8', 'pwm', 'D8 · PWM'],
];

/** Top edge, right block: D7 down to D0, the pair shared with USB last. */
const TOP_RIGHT: readonly PinSpec[] = [
  ['D7', '7', 'pwm', 'D7 · PWM'],
  ['D6', '6', 'pwm', 'D6 · PWM'],
  ['D5', '5', 'pwm', 'D5 · PWM'],
  ['D4', '4', 'pwm', 'D4 · PWM'],
  ['D3', '3', 'pwm', 'D3 · PWM, external interrupt 5'],
  ['D2', '2', 'pwm', 'D2 · PWM, external interrupt 4'],
  ['D1', 'TX0', 'uart-tx', 'D1 · UART0 TX, shared with the USB bridge'],
  ['D0', 'RX0', 'uart-rx', 'D0 · UART0 RX, shared with the USB bridge'],
];

/** Bottom edge, power block. */
const POWER: readonly PinSpec[] = [
  ['IOREF', 'IOR', 'vcc', 'Logic level a shield should match — 5 V on this board'],
  ['NC', 'NC', 'nc', 'Reserved, not connected'],
  ['RESET', 'RST', 'reset', 'Reset, active low'],
  ['3V3', '3V3', 'vcc', 'Regulated 3.3 V output, 50 mA maximum'],
  ['5V', '5V', 'vcc', 'Regulated 5 V output'],
  ['GND-P1', 'GND', 'gnd', 'Ground reference'],
  ['GND-P2', 'GND', 'gnd', 'Ground reference'],
  ['VIN', 'VIN', 'vcc', 'Unregulated input, 7 - 12 V through the barrel jack regulator'],
];

/** Bottom edge, analog inputs. Sixteen of them, in two blocks of eight. */
const ANALOG_LOW: readonly PinSpec[] = [0, 1, 2, 3, 4, 5, 6, 7].map(
  (index) =>
    [`A${index}`, `A${index}`, 'analog', `A${index} · ADC channel ${index}`] as const satisfies
      PinSpec | readonly [string, string, PinType, string],
);

const ANALOG_HIGH: readonly PinSpec[] = [8, 9, 10, 11, 12, 13, 14, 15].map(
  (index) =>
    [`A${index}`, `A${index}`, 'analog', `A${index} · ADC channel ${index}`] as const satisfies
      PinSpec | readonly [string, string, PinType, string],
);

/**
 * The 2 x 18 block, as it is numbered on the board: the inner column carries the
 * odd pins counting up from D23, the outer column the even pins from D22, and
 * the last two rows are the supply pair the block ends on.
 */
const BLOCK_INNER: readonly PinSpec[] = [
  ...[23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47, 49, 51, 53].map(
    (number) =>
      [`D${number}`, `${number}`, 'digital', `D${number} · general purpose digital`] as const,
  ),
  ['5V-B', '5V', 'vcc', 'Regulated 5 V output'],
  ['GND-B1', 'GND', 'gnd', 'Ground reference'],
];

const BLOCK_OUTER: readonly PinSpec[] = [
  ...[22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52].map(
    (number) =>
      [`D${number}`, `${number}`, 'digital', `D${number} · general purpose digital`] as const,
  ),
  ['5V-B2', '5V', 'vcc', 'Regulated 5 V output'],
  ['GND-B2', 'GND', 'gnd', 'Ground reference'],
];

/** The board's user LED: what `LED_BUILTIN` names, and what the artwork lights. */
const ONBOARD_LED: OnboardLed = { pin: '13', label: 'L' };

function rowPins(
  specs: readonly PinSpec[],
  x: number,
  y: number,
  side: 'top' | 'bottom',
): ReturnType<typeof pin>[] {
  return specs.map(([id, label, type, detail], index) =>
    pin(id, x + index * HEADER_PITCH, y, type, {
      side,
      description: detail,
      aliases: label === id ? undefined : [label],
      voltage: type !== 'vcc' ? undefined : id === '3V3' ? 3.3 : 5,
    }),
  );
}

function columnPins(
  specs: readonly PinSpec[],
  x: number,
  side: 'left' | 'right',
): ReturnType<typeof pin>[] {
  return specs.map(([id, label, type, detail], index) =>
    pin(id, x, BLOCK_TOP + index * HEADER_PITCH, type, {
      side,
      description: detail,
      aliases: label === id ? undefined : [label],
      voltage: type !== 'vcc' ? undefined : 5,
    }),
  );
}

function rowLabels(specs: readonly PinSpec[], x: number, y: number): readonly Shape[] {
  return specs.map(([, label], index) =>
    text(x + index * HEADER_PITCH, y, label, {
      size: u(1.05),
      fill: WOKWI.label,
      anchor: 'middle',
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
  );
}

function columnLabels(
  specs: readonly PinSpec[],
  x: number,
  anchor: 'start' | 'end',
): readonly Shape[] {
  return specs.map(([, label], index) =>
    text(x, BLOCK_TOP + index * HEADER_PITCH + u(0.35), label, {
      size: u(0.95),
      fill: WOKWI.label,
      anchor,
      weight: 600,
      mono: true,
      detail: 'normal',
    }),
  );
}

function draw(context: DeviceDrawContext): readonly Shape[] {
  const live = context.running;

  return [
    // PCB.
    rect(0, 0, WIDTH, HEIGHT, {
      rx: u(2),
      fill: WOKWI.arduinoBoard,
      stroke: WOKWI.arduinoBoardEdge,
      strokeWidth: u(0.25),
    }),
    rect(u(0.5), u(0.5), WIDTH - u(1), HEIGHT - u(1), {
      rx: u(1.6),
      fill: 'none',
      stroke: WOKWI.arduinoBoardTrace,
      strokeWidth: u(0.12),
      opacity: 0.7,
      detail: 'normal',
    }),

    // USB-B socket, overhanging the left edge exactly as the shell does.
    rect(-u(2), u(6.5), u(14), u(16), {
      rx: u(0.5),
      fill: WOKWI.usb,
      stroke: WOKWI.shieldEdge,
      strokeWidth: u(0.2),
    }),
    rect(u(0.4), u(8.6), u(9.4), u(11.8), {
      rx: u(0.3),
      fill: WOKWI.usbInset,
      detail: 'normal',
    }),

    // Barrel jack, below the USB socket on the same edge.
    rect(-u(1.5), u(33), u(13), u(11), {
      rx: u(0.8),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.2),
    }),
    circle(u(4.5), u(38.5), u(2.6), {
      fill: WOKWI.chipInset,
      stroke: WOKWI.buttonEdge,
      strokeWidth: u(0.15),
      detail: 'normal',
    }),

    // ATmega2560 in its TQFP-100 package: the largest thing on the board.
    rect(u(46), u(20), u(18), u(18), {
      rx: u(0.5),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.18),
    }),
    circle(u(48.6), u(22.6), u(1), { fill: WOKWI.chipInset, detail: 'normal' }),
    silkLabel(u(55), u(28), 'ATMEGA2560', {
      size: u(1.5),
      fill: WOKWI.label,
      detail: 'normal',
    }),
    silkLabel(u(55), u(31), '16AU', {
      size: u(1.2),
      fill: WOKWI.espBoardTrace,
      detail: 'high',
    }),

    // ATmega16U2 USB bridge, beside the socket.
    rect(u(17.5), u(10.5), u(8), u(8), {
      rx: u(0.35),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.15),
    }),
    silkLabel(u(21.5), u(15), '16U2', {
      size: u(1),
      fill: WOKWI.label,
      detail: 'high',
    }),

    // Regulator and its filter caps, along the power edge.
    rect(u(20), u(33), u(9), u(5.5), {
      rx: u(0.3),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.15),
      detail: 'normal',
    }),
    circle(u(33), u(36.5), u(3.2), {
      fill: WOKWI.chipInset,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.18),
      detail: 'normal',
    }),

    // Reset button, top-left corner where every Arduino puts it.
    rect(u(13), u(6.5), u(6), u(6), {
      rx: u(0.4),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.15),
    }),
    circle(u(16), u(9.5), u(2), {
      fill: WOKWI.button,
      stroke: WOKWI.buttonEdge,
      strokeWidth: u(0.18),
    }),
    silkLabel(u(16), u(14.6), 'RESET', {
      size: u(0.95),
      detail: 'high',
    }),

    // Status LEDs, below the top row's pin names. L follows D13 while the
    // simulation runs.
    ...[
      [u(30), u(11), onboardLedColor(context, WOKWI.ledBlue, WOKWI.ledBlueOff), 'L'],
      [u(34), u(11), live ? WOKWI.ledRed : WOKWI.ledRedOff, 'ON'],
      [u(38), u(11), WOKWI.ledRedOff, 'TX'],
      [u(42), u(11), WOKWI.ledRedOff, 'RX'],
    ].flatMap(([cx, cy, fill, name]) => [
      circle(cx as number, cy as number, u(1), { fill: fill as string }),
      silkLabel(cx as number, (cy as number) + u(2.9), name as string, {
        size: u(0.85),
        detail: 'high',
      }),
    ]),

    // In the open area between the MCU and the 2 x 18 block, clear of every
    // pin name and component.
    silkLabel(u(79), u(24), 'ARDUINO MEGA 2560 R3', {
      size: u(1.8),
      weight: 700,
      detail: 'normal',
    }),

    // Female headers. The top row is split into two blocks, and the far end
    // carries the double row that makes this board a Mega.
    ...flatHeader(TOP_LEFT_X, TOP_ROW_Y, TOP_LEFT.length),
    ...flatHeader(TOP_RIGHT_X, TOP_ROW_Y, TOP_RIGHT.length),
    ...flatHeader(POWER_X, BOTTOM_ROW_Y, POWER.length),
    ...flatHeader(ANALOG_LOW_X, BOTTOM_ROW_Y, ANALOG_LOW.length),
    ...flatHeader(ANALOG_HIGH_X, BOTTOM_ROW_Y, ANALOG_HIGH.length),
    ...flatHeader(BLOCK_INNER_X, BLOCK_TOP, BLOCK_INNER.length, 'vertical'),
    ...flatHeader(BLOCK_OUTER_X, BLOCK_TOP, BLOCK_OUTER.length, 'vertical'),

    // Silkscreen pin names, printed inboard of each row.
    ...rowLabels(TOP_LEFT, TOP_LEFT_X, TOP_ROW_Y + u(4.4)),
    ...rowLabels(TOP_RIGHT, TOP_RIGHT_X, TOP_ROW_Y + u(4.4)),
    ...rowLabels(POWER, POWER_X, BOTTOM_ROW_Y - u(3.4)),
    ...rowLabels(ANALOG_LOW, ANALOG_LOW_X, BOTTOM_ROW_Y - u(3.4)),
    ...rowLabels(ANALOG_HIGH, ANALOG_HIGH_X, BOTTOM_ROW_Y - u(3.4)),
    ...columnLabels(BLOCK_INNER, BLOCK_INNER_X - u(1.6), 'end'),

    silkLabel(u(53), u(10), 'DIGITAL (PWM ~)', {
      size: u(1.1),
      detail: 'high',
    }),
    silkLabel(u(50), BOTTOM_ROW_Y - u(6.4), 'ANALOG IN', {
      size: u(1.1),
      detail: 'high',
    }),
    silkLabel(u(23), BOTTOM_ROW_Y - u(6.4), 'POWER', {
      size: u(1.1),
      detail: 'high',
    }),
  ];
}

export const ARDUINO_MEGA_2560: VirtualDevice = {
  defaultSpi: { mosi: 'D51', miso: 'D50', clock: 'D52', select: 'D53' },
  id: 'arduino-mega-2560',
  name: 'Arduino Mega 2560',
  model: 'Arduino Mega 2560 R3',
  description:
    '54 digital pins, 16 analog inputs and four UARTs — the Uno when you run out of pins.',
  x: 60,
  y: 60,
  ...BODY,
  initiallyVisible: false,
  printsOwnPinLabels: true,
  powerSource: true,
  logicVoltage: 5,
  maxLogicInputVoltage: 5.5,
  operatingVoltage: { min: 7, max: 12, recommended: 9 },
  interfaces: ['digital', 'analog', 'pwm', 'i2c', 'spi', 'uart', 'power'],
  pins: [
    ...rowPins(TOP_LEFT, TOP_LEFT_X, TOP_ROW_Y, 'top'),
    ...rowPins(TOP_RIGHT, TOP_RIGHT_X, TOP_ROW_Y, 'top'),
    ...rowPins(POWER, POWER_X, BOTTOM_ROW_Y, 'bottom'),
    ...rowPins(ANALOG_LOW, ANALOG_LOW_X, BOTTOM_ROW_Y, 'bottom'),
    ...rowPins(ANALOG_HIGH, ANALOG_HIGH_X, BOTTOM_ROW_Y, 'bottom'),
    ...columnPins(BLOCK_INNER, BLOCK_INNER_X, 'left'),
    ...columnPins(BLOCK_OUTER, BLOCK_OUTER_X, 'right'),
  ],
  render: { draw, bleed: { left: u(2.5) } },
  onboardLed: ONBOARD_LED,
  simulation: (instanceId) => createBoardBehavior(instanceId, AVR_RUNTIME, ONBOARD_LED),
  catalog: {
    categoryId: 'microcontrollers',
    category: 'Microcontrollers',
    aliases: ['mega', 'arduino mega', 'mega2560', 'atmega2560', 'อาร์ดูโน่ เมก้า'],
    tags: ['arduino', 'mega', 'atmega2560', 'microcontroller', 'board', '5V', 'uart'],
    interfaceLabel: 'ดิจิทัล / แอนะล็อก · 70 ขา',
    typicalUsage: 'Projects with many sensors, displays or motors that outgrow an Uno.',
  },
};
