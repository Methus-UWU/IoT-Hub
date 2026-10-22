import type { VirtualDevice } from '../../models/virtual-device.model';
import type { DeviceDrawContext } from '../core/device-definition';
import { bodyFromMm, HEADER_PITCH, u } from '../core/device-metrics';
import { FLAT, OUTLINE, SILK } from '../core/device-palette';
import { chip, flatBoard, flatHeader, pcbAntenna, silkLabel } from '../core/device-parts';
import { pin } from '../core/device-pin';
import { circle, rect, text, type Shape } from '../core/device-shape';
import { requiresSupply } from '../core/device-simulation';

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
    ...flatBoard(WIDTH, HEIGHT),

    rect(u(1.2), u(0.8), u(25), u(9.6), {
      rx: u(0.4),
      fill: FLAT.board,
      stroke: FLAT.boardTrace,
      strokeWidth: u(0.18),
    }),

    // Stamped steel shield can over the radio.
    rect(u(2.2), u(1.6), u(15.5), u(8), {
      rx: u(0.35),
      fill: FLAT.metalLight,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.16),
    }),
    // Seam and dimples pressed into the lid.
    rect(u(2.9), u(2.3), u(14.1), u(6.6), {
      rx: u(0.25),
      fill: 'none',
      stroke: FLAT.metalDark,
      strokeWidth: u(0.12),
      opacity: 0.8,
      detail: 'normal',
    }),
    text(u(9.95), u(6), 'HC-05', {
      size: u(1.5),
      fill: FLAT.plastic,
      anchor: 'middle',
      mono: true,
      weight: 700,
      detail: 'normal',
    }),

    // 26 MHz crystal beside the can, and the regulator that feeds the radio.
    rect(u(19), u(2), u(5.4), u(2.6), {
      rx: u(0.5),
      fill: FLAT.metalLight,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.12),
      detail: 'normal',
    }),
    ...chip(u(19), u(5.6), u(4.2), u(3), '3V3', {
      labelSize: u(0.8),
      fill: FLAT.plastic,
      flat: true,
    }),

    // Meandered antenna in its keep-out at the far end.
    pcbAntenna(u(27), u(1.5), u(7), u(4)),

    // Link status LED. It blinks on real hardware; drawn steady here because a
    // blink the workspace cannot time would be a decoration, not a signal.
    circle(u(28), u(8), u(0.7), {
      fill: context.running && context.state['powered'] === true ? FLAT.gold : FLAT.red,
      stroke: FLAT.plastic,
      strokeWidth: u(0.1),
    }),
    silkLabel(u(30.6), u(8.4), 'LED', { size: u(0.8), fill: SILK.dim, detail: 'high' }),

    // KEY / EN button, the one people hold down to reach AT mode.
    rect(u(32.4), u(6.4), u(3.4), u(3.4), {
      rx: u(0.4),
      fill: FLAT.plastic,
      stroke: OUTLINE,
      strokeWidth: u(0.14),
      detail: 'normal',
    }),
    circle(u(34.1), u(8.1), u(1.1), {
      fill: FLAT.metal,
      stroke: FLAT.metalDark,
      strokeWidth: u(0.1),
      detail: 'normal',
    }),
    silkLabel(u(34.1), u(5.4), 'KEY', { size: u(0.8), fill: SILK.soft, detail: 'high' }),

    ...flatHeader(PIN_START_X, PIN_Y, PINS.length),
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
  logicVoltage: 3.3,
  maxLogicInputVoltage: 3.6,
  supplyCurrentMa: 40,
  interfaces: ['uart'],
  pins: PINS.map(([name, type, detail], index) =>
    pin(name, PIN_START_X + index * HEADER_PITCH, PIN_Y, type, {
      side: 'bottom',
      description: detail,
      voltage: name === 'VCC' ? 5 : undefined,
      maxInputVoltage: name === 'RXD' ? 3.6 : undefined,
    }),
  ),
  render: { draw },
  // No radio is modelled; the behaviour exists so the link lamp needs real power.
  simulation: requiresSupply(() => ({}), { minimumVolts: 3.6 }),
  catalog: {
    categoryId: 'communication',
    category: 'Communication',
    aliases: ['bluetooth', 'hc-05', 'hc05', 'บลูทูธ', 'serial bluetooth'],
    tags: ['bluetooth', 'hc-05', 'uart', 'serial', 'wireless', 'communication'],
    interfaceLabel: 'UART · 4 ขา',
    typicalUsage: 'Phone-to-board control, wireless serial logging, and remote commands.',
  },
};
