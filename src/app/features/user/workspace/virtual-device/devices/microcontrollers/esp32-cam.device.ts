import type { OnboardLed, VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { WOKWI } from '../core/device-palette';
import { flatHeader, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, rect, text, type Shape } from '../core/device-shape';
import type { PinType } from '../core/device-types';
import { createBoardBehavior, ESP32_RUNTIME, onboardLedColor } from './board-behavior';

/**
 * AI-Thinker ESP32-CAM — a 27 × 40.5 mm board that is mostly camera.
 *
 * Three things dominate the artwork because they dominate the hardware: the
 * ESP32-S module with its meandered antenna along the top edge, the FPC socket
 * the OV2640 ribbon clamps into, and the microSD cage across the bottom. The
 * board is drawn to those real millimetres like every other part, so beside a
 * DevKit V1 it reads as the shorter, wider board it is.
 *
 * Two things about this board that the pinout below encodes and that catch
 * people out: there is no USB bridge at all — U0R/U0T go to an external
 * adapter — and GPIO0 must be pulled to ground to enter the bootloader, which
 * is why it is named rather than buried among the numbered pins.
 */

const BODY = bodyFromMm({ widthMm: 27, heightMm: 40.5 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

/** Both 8-way headers run down the long edges, ending level with the SD cage. */
const LEFT_HEADER_X = u(2.2);
const RIGHT_HEADER_X = WIDTH - u(2.2);
const HEADER_TOP = u(19.4);

/** The ESP32-S module, antenna along the top edge. */
const MODULE_X = u(4.5);
const MODULE_WIDTH = WIDTH - u(9);
const MODULE_TOP = u(0.9);
const MODULE_HEIGHT = u(12.4);
const SHIELD_TOP = MODULE_TOP + u(5.6);

type PinSpec = readonly [id: string, label: string, type: PinType, detail: string];

/** Left header, top to bottom with the antenna held upwards. */
const LEFT_HEADER: readonly PinSpec[] = [
  ['5V', '5V', 'vcc', '5 V input — the regulator feeds the module from here'],
  ['GND-L', 'GND', 'gnd', 'Ground reference'],
  ['GPIO12', 'IO12', 'digital', 'GPIO12 · shared with the SD card in 4-bit mode — strapping pin'],
  ['GPIO13', 'IO13', 'digital', 'GPIO13 · shared with the SD card in 4-bit mode'],
  ['GPIO15', 'IO15', 'digital', 'GPIO15 · SD CMD — strapping pin'],
  ['GPIO14', 'IO14', 'digital', 'GPIO14 · SD CLK'],
  ['GPIO2', 'IO2', 'digital', 'GPIO2 · SD DATA0 — strapping pin'],
  ['GPIO4', 'IO4', 'digital', 'GPIO4 · SD DATA1, also the white flash LED'],
];

/** Right header, top to bottom. */
const RIGHT_HEADER: readonly PinSpec[] = [
  ['3V3', '3V3', 'vcc', 'Regulated 3.3 V, also usable as a 3.3 V input'],
  ['GPIO16', 'IO16', 'digital', 'GPIO16 · the only GPIO the camera and SD leave free'],
  ['GPIO0', 'IO0', 'digital', 'GPIO0 · tie to GND to enter the bootloader — strapping pin'],
  ['GND-R', 'GND', 'gnd', 'Ground reference'],
  ['VCC', 'VCC', 'vcc', 'Module supply, 3.3 V by default'],
  ['GPIO3', 'U0R', 'uart-rx', 'GPIO3 · UART0 RX, to the TX of an external USB adapter'],
  ['GPIO1', 'U0T', 'uart-tx', 'GPIO1 · UART0 TX, to the RX of an external USB adapter'],
  ['GND-R2', 'GND', 'gnd', 'Ground reference'],
];

/** The board's user LED: what `LED_BUILTIN` names, and what the artwork lights. */
const ONBOARD_LED: OnboardLed = { pin: 'GPIO4', label: 'FL' };

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
      voltage: type !== 'vcc' ? undefined : id === '5V' ? 5 : 3.3,
    }),
  );
}

function headerLabels(
  specs: readonly PinSpec[],
  x: number,
  anchor: 'start' | 'end',
): readonly Shape[] {
  return specs.map(([, label], index) =>
    text(x, HEADER_TOP + index * HEADER_PITCH + u(0.32), label, {
      size: u(0.85),
      fill: WOKWI.label,
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
      rx: u(0.9),
      fill: WOKWI.espBoard,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.2),
    }),
    rect(u(0.3), u(0.3), WIDTH - u(0.6), HEIGHT - u(0.6), {
      rx: u(0.7),
      fill: 'none',
      stroke: WOKWI.espBoardTrace,
      strokeWidth: u(0.1),
      opacity: 0.7,
      detail: 'normal',
    }),

    // ESP32-S module: substrate, printed antenna, then the shield can.
    rect(MODULE_X, MODULE_TOP, MODULE_WIDTH, MODULE_HEIGHT, {
      rx: u(0.35),
      fill: WOKWI.module,
      stroke: WOKWI.shieldEdge,
      strokeWidth: u(0.12),
    }),
    {
      kind: 'path',
      d: [
        `M ${MODULE_X + u(1.8)} ${MODULE_TOP + u(1.2)}`,
        `h ${MODULE_WIDTH - u(3.6)}`,
        `M ${MODULE_X + u(1.8)} ${MODULE_TOP + u(1.2)} v ${u(1.2)}`,
        `M ${MODULE_X + MODULE_WIDTH - u(1.8)} ${MODULE_TOP + u(1.2)} v ${u(1.2)}`,
        `M ${MODULE_X + u(3)} ${MODULE_TOP + u(2.4)} v ${u(1.4)}`,
        `M ${MODULE_X + u(5)} ${MODULE_TOP + u(2.4)} v ${u(1.4)}`,
        `M ${MODULE_X + u(7)} ${MODULE_TOP + u(2.4)} v ${u(1.4)}`,
        `M ${MODULE_X + u(9)} ${MODULE_TOP + u(2.4)} v ${u(1.4)}`,
        `M ${MODULE_X + u(11)} ${MODULE_TOP + u(2.4)} v ${u(1.4)}`,
        `M ${MODULE_X + u(13)} ${MODULE_TOP + u(2.4)} v ${u(1.4)}`,
        `M ${MODULE_X + u(3)} ${MODULE_TOP + u(3.8)} h ${u(12)}`,
      ].join(' '),
      fill: 'none',
      stroke: WOKWI.antenna,
      strokeWidth: u(0.28),
      strokeLinecap: 'round',
    },
    rect(
      MODULE_X + u(0.3),
      SHIELD_TOP,
      MODULE_WIDTH - u(0.6),
      MODULE_TOP + MODULE_HEIGHT - SHIELD_TOP - u(0.3),
      {
        rx: u(0.28),
        fill: WOKWI.shield,
        stroke: WOKWI.shieldEdge,
        strokeWidth: u(0.14),
      },
    ),
    silkLabel(WIDTH / 2, SHIELD_TOP + u(3.9), 'ESP32-S', {
      size: u(1.1),
      fill: WOKWI.espBoard,
      weight: 700,
      detail: 'normal',
    }),

    // The FPC socket the camera ribbon clamps into: body, then the flip latch.
    rect(u(5.6), u(14), WIDTH - u(11.2), u(4.2), {
      rx: u(0.3),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.12),
    }),
    rect(u(6.4), u(14.6), WIDTH - u(12.8), u(1.5), {
      rx: u(0.18),
      fill: WOKWI.chipInset,
      detail: 'normal',
    }),
    silkLabel(WIDTH / 2, u(20.2), 'CAMERA', {
      size: u(0.8),
      fill: WOKWI.espBoardTrace,
      detail: 'high',
    }),

    // The white flash LED sits on the board edge and follows GPIO4 while the
    // simulation runs, which is the one thing on this board a user can see.
    circle(u(3.4), u(15.4), u(1.1), {
      fill: onboardLedColor(context, '#fdfbe7', '#b8bcc4'),
      stroke: WOKWI.shieldEdge,
      strokeWidth: u(0.12),
    }),
    silkLabel(u(3.4), u(17.6), 'FL', {
      size: u(0.7),
      fill: WOKWI.espBoardTrace,
      detail: 'high',
    }),

    // microSD cage, hanging over the bottom edge exactly as the metal shell does.
    rect(u(6), u(25.5), WIDTH - u(12), u(13.5), {
      rx: u(0.4),
      fill: WOKWI.shield,
      stroke: WOKWI.shieldEdge,
      strokeWidth: u(0.16),
    }),
    rect(u(7.2), u(27), WIDTH - u(14.4), u(9), {
      rx: u(0.25),
      fill: 'none',
      stroke: WOKWI.buttonEdge,
      strokeWidth: u(0.1),
      detail: 'normal',
    }),
    silkLabel(WIDTH / 2, u(32.4), 'TF', {
      size: u(1),
      fill: WOKWI.espBoard,
      weight: 700,
      detail: 'normal',
    }),

    // Reset button, opposite the flash LED. Beside the cage it sat on the left
    // header and covered IO4's name.
    rect(WIDTH - u(5.3), u(13.7), u(3.4), u(3.4), {
      rx: u(0.3),
      fill: WOKWI.chip,
      stroke: WOKWI.espBoardEdge,
      strokeWidth: u(0.12),
    }),
    circle(WIDTH - u(3.6), u(15.4), u(1.1), {
      fill: WOKWI.button,
      stroke: WOKWI.buttonEdge,
      strokeWidth: u(0.12),
    }),

    silkLabel(WIDTH / 2, u(23.5), 'ESP32-CAM', {
      size: u(1),
      weight: 600,
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

export const ESP32_CAM: VirtualDevice = {
  id: 'esp32-cam',
  name: 'ESP32-CAM',
  model: 'AI-Thinker ESP32-CAM',
  description: 'ESP32-S with an OV2640 camera socket and microSD. Needs an external USB adapter.',
  x: 80,
  y: 60,
  ...BODY,
  initiallyVisible: false,
  printsOwnPinLabels: true,
  powerSource: true,
  logicVoltage: 3.3,
  maxLogicInputVoltage: 3.6,
  operatingVoltage: { min: 3, max: 5.5, recommended: 5 },
  interfaces: ['digital', 'uart', 'power'],
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
    aliases: ['esp32-cam', 'esp32 cam', 'ai-thinker', 'ov2640', 'กล้อง esp32'],
    tags: ['esp32', 'camera', 'wifi', 'microcontroller', 'board', 'sd', 'ov2640'],
    interfaceLabel: 'ดิจิทัล · 16 ขา',
    typicalUsage: 'Wi-Fi cameras, doorbells, and time-lapse capture to microSD.',
  },
};
