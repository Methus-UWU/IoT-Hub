import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, u } from '../core/device-metrics';
import { WOKWI } from '../core/device-palette';
import { silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { rect, type Shape } from '../core/device-shape';
import type { PinType } from '../core/device-types';
import { createBoardBehavior, ESP32_RUNTIME } from './board-behavior';

/**
 * ESP-WROOM-32 — the bare module, not a board built around one.
 *
 * 18 × 25.5 mm with 38 castellated pads: fourteen down each long edge and eight
 * across the bottom. There is no regulator, no USB bridge and no buttons, which
 * is the whole point of choosing it — you supply 3.3 V and drive EN and IO0
 * yourself. The pinout says so rather than the artwork, because on the real
 * module there is nothing there to draw.
 *
 * Pads sit on a 1.27 mm pitch, half the pitch of a header, so pad names are not
 * printed: at true scale they would be unreadable smudges. The canvas discloses
 * a name on hover instead, which is why `printsOwnPinLabels` is off here while
 * every dev board in the catalog has it on.
 *
 * The six SD pads (SD0-SD3, CMD, CLK) are wired to the module's own SPI flash.
 * They are exposed because the package exposes them, and their descriptions
 * warn that using them will stop the chip from booting.
 */

const BODY = bodyFromMm({ widthMm: 18, heightMm: 25.5 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

/** Castellated pads: 1.27 mm pitch, clear of the antenna at the top. */
const PAD_PITCH = u(1.27);
const SIDE_PAD_TOP = u(7.3);
const BOTTOM_PAD_Y = HEIGHT;
const BOTTOM_PAD_START_X = (WIDTH - PAD_PITCH * 7) / 2;

type PinSpec = readonly [id: string, type: PinType, detail: string];

/** Left edge, pads 1-14, antenna uppermost. */
const LEFT_PADS: readonly PinSpec[] = [
  ['GND-1', 'gnd', 'Ground reference'],
  ['3V3', 'vcc', 'Module supply, 3.0 - 3.6 V — this pad is an input, not an output'],
  ['EN', 'reset', 'Chip enable, active low. Needs a pull-up and a 100 nF to ground'],
  ['GPIO36', 'analog', 'GPIO36 · SENSOR_VP, ADC1 CH0, input only'],
  ['GPIO39', 'analog', 'GPIO39 · SENSOR_VN, ADC1 CH3, input only'],
  ['GPIO34', 'analog', 'GPIO34 · ADC1 CH6, input only'],
  ['GPIO35', 'analog', 'GPIO35 · ADC1 CH7, input only'],
  ['GPIO32', 'digital', 'GPIO32 · ADC1 CH4, touch 9'],
  ['GPIO33', 'digital', 'GPIO33 · ADC1 CH5, touch 8'],
  ['GPIO25', 'digital', 'GPIO25 · ADC2 CH8, DAC1'],
  ['GPIO26', 'digital', 'GPIO26 · ADC2 CH9, DAC2'],
  ['GPIO27', 'digital', 'GPIO27 · ADC2 CH7, touch 7'],
  ['GPIO14', 'digital', 'GPIO14 · ADC2 CH6, touch 6, HSPI CLK'],
  ['GPIO12', 'digital', 'GPIO12 · strapping pin — held high at boot the chip will not start'],
];

/** Bottom edge, pads 15-22, left to right. */
const BOTTOM_PADS: readonly PinSpec[] = [
  ['GND-2', 'gnd', 'Ground reference'],
  ['GPIO13', 'digital', 'GPIO13 · ADC2 CH4, touch 4, HSPI MOSI'],
  ['GPIO9', 'nc', 'GPIO9 · SD2, wired to the onboard flash — leave unconnected'],
  ['GPIO10', 'nc', 'GPIO10 · SD3, wired to the onboard flash — leave unconnected'],
  ['GPIO11', 'nc', 'GPIO11 · CMD, wired to the onboard flash — leave unconnected'],
  ['GPIO6', 'nc', 'GPIO6 · CLK, wired to the onboard flash — leave unconnected'],
  ['GPIO7', 'nc', 'GPIO7 · SD0, wired to the onboard flash — leave unconnected'],
  ['GPIO8', 'nc', 'GPIO8 · SD1, wired to the onboard flash — leave unconnected'],
];

/** Right edge, pads 23-38, bottom to top. */
const RIGHT_PADS: readonly PinSpec[] = [
  ['GPIO15', 'digital', 'GPIO15 · strapping pin, silences the boot log when pulled low'],
  ['GPIO2', 'digital', 'GPIO2 · strapping pin, must be low or floating to enter the bootloader'],
  ['GPIO0', 'digital', 'GPIO0 · strapping pin, hold low at reset to enter the bootloader'],
  ['GPIO4', 'digital', 'GPIO4 · ADC2 CH0, touch 0'],
  ['GPIO16', 'digital', 'GPIO16 · free GPIO, often used as UART2 RX'],
  ['GPIO17', 'digital', 'GPIO17 · free GPIO, often used as UART2 TX'],
  ['GPIO5', 'digital', 'GPIO5 · VSPI CS — strapping pin, outputs a pulse train at boot'],
  ['GPIO18', 'digital', 'GPIO18 · VSPI CLK'],
  ['GPIO19', 'digital', 'GPIO19 · VSPI MISO'],
  ['NC', 'nc', 'Not connected'],
  ['GPIO21', 'i2c-sda', 'GPIO21 · default I2C SDA'],
  ['GPIO3', 'uart-rx', 'GPIO3 · UART0 RX'],
  ['GPIO1', 'uart-tx', 'GPIO1 · UART0 TX'],
  ['GPIO22', 'i2c-scl', 'GPIO22 · default I2C SCL'],
  ['GPIO23', 'digital', 'GPIO23 · VSPI MOSI'],
  ['GND-3', 'gnd', 'Ground reference'],
];

function sidePads(
  specs: readonly PinSpec[],
  x: number,
  side: 'left' | 'right',
  order: 'down' | 'up',
): ReturnType<typeof pin>[] {
  return specs.map(([id, type, detail], index) => {
    const step = order === 'down' ? index : specs.length - 1 - index;
    return pin(id, x, sidePadY(specs.length, step), type, {
      side,
      description: detail,
      voltage: type === 'vcc' ? 3.3 : undefined,
    });
  });
}

/** Keep the longer right row inside the body, using the same geometry for art and pins. */
function sidePadY(count: number, index: number): number {
  const top = Math.min(SIDE_PAD_TOP, HEIGHT - u(1) - (count - 1) * PAD_PITCH);
  return top + index * PAD_PITCH;
}

/** The pads themselves: a plated half-hole on the module's edge. */
function padArt(): readonly Shape[] {
  const width = u(0.85);
  const height = u(0.7);

  return [
    ...LEFT_PADS.map((_, index) =>
      rect(-width / 2, sidePadY(LEFT_PADS.length, index) - height / 2, width, height, {
        rx: u(0.12),
        fill: WOKWI.gold,
        detail: 'normal',
      }),
    ),
    ...RIGHT_PADS.map((_, index) =>
      rect(
        WIDTH - width / 2,
        sidePadY(RIGHT_PADS.length, RIGHT_PADS.length - 1 - index) - height / 2,
        width,
        height,
        { rx: u(0.12), fill: WOKWI.gold, detail: 'normal' },
      ),
    ),
    ...BOTTOM_PADS.map((_, index) =>
      rect(
        BOTTOM_PAD_START_X + index * PAD_PITCH - height / 2,
        BOTTOM_PAD_Y - width / 2,
        height,
        width,
        { rx: u(0.12), fill: WOKWI.gold, detail: 'normal' },
      ),
    ),
  ];
}

function draw(_context: DeviceDrawContext): readonly Shape[] {
  return [
    // Module substrate.
    rect(0, 0, WIDTH, HEIGHT, {
      rx: u(0.4),
      fill: WOKWI.module,
      stroke: WOKWI.shieldEdge,
      strokeWidth: u(0.15),
    }),

    // Meandered PCB antenna along the top edge — the reason the module is
    // 25.5 mm long rather than the 18 mm the shield alone would need.
    {
      kind: 'path',
      d: [
        `M ${u(2)} ${u(1.4)}`,
        `h ${u(14)}`,
        `M ${u(2)} ${u(1.4)} v ${u(1.4)}`,
        `M ${u(16)} ${u(1.4)} v ${u(1.4)}`,
        `M ${u(3)} ${u(2.8)} v ${u(1.6)}`,
        `M ${u(5)} ${u(2.8)} v ${u(1.6)}`,
        `M ${u(7)} ${u(2.8)} v ${u(1.6)}`,
        `M ${u(9)} ${u(2.8)} v ${u(1.6)}`,
        `M ${u(11)} ${u(2.8)} v ${u(1.6)}`,
        `M ${u(13)} ${u(2.8)} v ${u(1.6)}`,
        `M ${u(15)} ${u(2.8)} v ${u(1.6)}`,
        `M ${u(3)} ${u(4.4)} h ${u(12)}`,
      ].join(' '),
      fill: 'none',
      stroke: WOKWI.antenna,
      strokeWidth: u(0.3),
      strokeLinecap: 'round',
    },

    // The shield can covering everything below the antenna.
    rect(u(0.5), u(6.2), WIDTH - u(1), HEIGHT - u(6.7), {
      rx: u(0.3),
      fill: WOKWI.shield,
      stroke: WOKWI.shieldEdge,
      strokeWidth: u(0.15),
    }),
    rect(u(1.3), u(7), WIDTH - u(2.6), HEIGHT - u(8.3), {
      rx: u(0.22),
      fill: 'none',
      stroke: WOKWI.buttonEdge,
      strokeWidth: u(0.08),
      detail: 'normal',
    }),

    silkLabel(WIDTH / 2, u(13.6), 'ESP-WROOM-32', {
      size: u(1.1),
      fill: WOKWI.espBoard,
      weight: 700,
      detail: 'normal',
    }),
    silkLabel(WIDTH / 2, u(16), 'ESP32-D0WDQ6', {
      size: u(0.78),
      fill: WOKWI.shieldEdge,
      detail: 'high',
    }),
    silkLabel(WIDTH / 2, u(20.4), 'FCC ID', {
      size: u(0.68),
      fill: WOKWI.shieldEdge,
      detail: 'high',
    }),

    ...padArt(),
  ];
}

export const ESP32_WROOM_32: VirtualDevice = {
  defaultSpi: { mosi: 'GPIO23', miso: 'GPIO19', clock: 'GPIO18', select: 'GPIO5' },
  id: 'esp32-wroom-32',
  name: 'ESP32-WROOM-32',
  model: 'Espressif ESP32-WROOM-32 module',
  description: 'The bare 38-pad module. Supply 3.3 V yourself — no regulator, USB or buttons.',
  x: 80,
  y: 60,
  ...BODY,
  initiallyVisible: false,
  // Pads sit at half header pitch, so a printed name would be a smudge. The
  // canvas discloses one on hover instead.
  printsOwnPinLabels: false,
  pinHitRadius: 5,
  operatingVoltage: { min: 3, max: 3.6, recommended: 3.3 },
  interfaces: ['digital', 'analog', 'pwm', 'i2c', 'spi', 'uart'],
  pins: [
    ...sidePads(LEFT_PADS, 0, 'left', 'down'),
    ...sidePads(RIGHT_PADS, WIDTH, 'right', 'up'),
    ...BOTTOM_PADS.map(([id, type, detail], index) =>
      pin(id, BOTTOM_PAD_START_X + index * PAD_PITCH, BOTTOM_PAD_Y, type, {
        side: 'bottom',
        description: detail,
      }),
    ),
  ],
  render: { draw },
  simulation: (instanceId) => createBoardBehavior(instanceId, ESP32_RUNTIME),
  catalog: {
    categoryId: 'microcontrollers',
    category: 'Microcontrollers',
    aliases: ['wroom', 'esp32-wroom', 'esp32 module', 'โมดูล esp32'],
    tags: ['esp32', 'wroom', 'module', 'wifi', 'bluetooth', 'castellated', 'smd'],
    interfaceLabel: 'ดิจิทัล / แอนะล็อก · 38 แพด',
    typicalUsage: 'Designs that solder the module straight onto their own PCB.',
  },
};
