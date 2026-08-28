import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { OUTLINE, PCB, SILK } from '../core/device-palette';
import { board, chip, indicatorLed, maleHeader, pcbAntenna, PIN_PITCH, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { rect, type Shape } from '../core/device-shape';

const WIDTH = 210;
const HEIGHT = 150;
const PIN_Y = HEIGHT;
const PIN_START_X = WIDTH / 2 - PIN_PITCH * 1.5;

function draw(context: DeviceDrawContext): readonly Shape[] {
  return [
    ...board(0, 0, WIDTH, HEIGHT, PCB.blue, { rx: 8, edge: PCB.blueDark }),
    // Metal-can module carrying the radio.
    rect(18, 22, WIDTH - 36, 78, {
      rx: 4,
      fill: '#c7ccd3',
      stroke: '#8d959f',
      strokeWidth: 1.5,
    }),
    ...chip(46, 40, 96, 42, 'BC417', { labelSize: 10, fill: '#9aa0a8' }),
    pcbAntenna(WIDTH - 74, 26, 52, 30),
    // Link status LED blinks in the real thing; drawn steady here.
    ...indicatorLed(28, 112, 'red', context.running),
    ...maleHeader(PIN_START_X, PIN_Y - 14, 4, 'horizontal'),
    silkLabel(WIDTH / 2, HEIGHT - 24, 'HC-05', { size: 12, fill: SILK.white, weight: 700 }),
  ];
}

/** HC-05 Bluetooth Classic serial bridge. */
export const HC05_BLUETOOTH: VirtualDevice = {
  id: 'hc05-bluetooth',
  name: 'Bluetooth module',
  model: 'HC-05',
  description: 'Bridges a UART to Bluetooth Classic — a wireless serial cable.',
  x: 640,
  y: 320,
  width: WIDTH,
  height: HEIGHT,
  initiallyVisible: false,
  operatingVoltage: { min: 3.6, max: 6, recommended: 5 },
  interfaces: ['uart'],
  pins: [
    pin('VCC', PIN_START_X, PIN_Y, 'vcc', {
      side: 'bottom',
      description: '3.6–6 V, onboard regulator feeds the 3.3 V radio',
      voltage: 5,
    }),
    pin('GND', PIN_START_X + PIN_PITCH, PIN_Y, 'gnd', { side: 'bottom', description: 'Ground' }),
    pin('TXD', PIN_START_X + PIN_PITCH * 2, PIN_Y, 'uart-tx', {
      side: 'bottom',
      description: 'Module transmit — wire to the controller RX',
    }),
    pin('RXD', PIN_START_X + PIN_PITCH * 3, PIN_Y, 'uart-rx', {
      side: 'bottom',
      description: 'Module receive — 3.3 V logic, use a divider from a 5 V TX',
    }),
  ],
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
