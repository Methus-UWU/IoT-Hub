import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { PCB, SILK } from '../core/device-palette';
import {
  board,
  chip,
  indicatorLed,
  maleHeader,
  pcbAntenna,
  silkLabel,
} from '../core/device-parts';
import { pin } from '../core/device-pin';
import { rect, text, type Shape } from '../core/device-shape';

/**
 * HC-05 Bluetooth Classic serial bridge, on the usual 37 × 16 mm breakout.
 *
 * Most of the board is taken by the shielded radio module and its meandered
 * antenna, which is why the header is crowded into one corner — the arrangement
 * that surprises people the first time they try to wire one on a breadboard.
 */

const BODY = bodyFromMm({ widthMm: 37, heightMm: 16 });
const WIDTH = BODY.width;
const HEIGHT = BODY.height;

const PIN_Y = u(13.6);
const PIN_START_X = u(4);

const PINS = [
  ['VCC', 'vcc', '3.6–6 V, onboard regulator feeds the 3.3 V radio'],
  ['GND', 'gnd', 'Ground reference'],
  ['TXD', 'uart-tx', 'Module transmit — wire to the controller RX'],
  ['RXD', 'uart-rx', 'Module receive — 3.3 V logic, use a divider from a 5 V TX'],
] as const;

function draw(context: DeviceDrawContext): readonly Shape[] {
  return [
    ...board(0, 0, WIDTH, HEIGHT, PCB.blue, { rx: u(0.8), edge: PCB.blueDark }),

    // Shielded radio module.
    rect(u(1.5), u(1), u(24), u(9), {
      rx: u(0.4),
      fill: '#c7ccd3',
      stroke: '#8d959f',
      strokeWidth: u(0.15),
    }),
    ...chip(u(4), u(2.5), u(9), u(5.5), 'BC417', { labelSize: u(1), fill: '#9aa0a8' }),
    rect(u(15), u(3), u(4), u(2), {
      rx: u(0.2),
      fill: '#b9c0c9',
      stroke: '#8d959f',
      strokeWidth: u(0.1),
      detail: 'normal',
    }),
    silkLabel(u(13.5), u(9.2), 'HC-05', {
      size: u(1.2),
      fill: '#5b6472',
      weight: 700,
      detail: 'normal',
    }),

    // Meandered antenna in its keep-out at the far end.
    pcbAntenna(u(27), u(1.5), u(7), u(4)),

    // Link status LED. It blinks on real hardware; drawn steady here because a
    // blink the workspace cannot time would be a decoration, not a signal.
    ...indicatorLed(u(28), u(8), 'red', context.running, u(0.7)),

    ...maleHeader(PIN_START_X, PIN_Y, PINS.length, 'horizontal'),
    ...PINS.map(([name], index) =>
      text(PIN_START_X + index * HEADER_PITCH, PIN_Y - u(2), name, {
        size: u(0.9),
        fill: SILK.white,
        anchor: 'middle',
        mono: true,
        weight: 600,
        detail: 'high',
      }),
    ),
  ];
}

export const HC05_BLUETOOTH: VirtualDevice = {
  id: 'hc05-bluetooth',
  name: 'Bluetooth module',
  model: 'HC-05',
  description: 'Bridges a UART to Bluetooth Classic — a wireless serial cable.',
  x: 640,
  y: 320,
  ...BODY,
  initiallyVisible: false,
  operatingVoltage: { min: 3.6, max: 6, recommended: 5 },
  interfaces: ['uart'],
  pins: PINS.map(([name, type, detail], index) =>
    pin(name, PIN_START_X + index * HEADER_PITCH, PIN_Y, type, {
      side: 'bottom',
      description: detail,
      voltage: name === 'VCC' ? 5 : undefined,
    }),
  ),
  render: { draw },
  catalog: {
    categoryId: 'communication',
    category: 'Communication',
    aliases: ['bluetooth', 'hc-05', 'hc05', 'บลูทูธ', 'serial bluetooth'],
    tags: ['bluetooth', 'hc-05', 'uart', 'serial', 'wireless', 'communication'],
    interfaceLabel: 'UART · 4 ขา',
    typicalUsage: 'Phone-to-board control, wireless serial logging, and remote commands.',
  },
};
