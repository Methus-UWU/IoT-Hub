import type { VirtualDevice } from '../../models/virtual-device.model';
import { numberState, stringState } from '../core/device-definition';
import { moduleBoard } from '../core/module-board';
import { readBusFrame } from '../core/multi-pin-bus';
import { circle, rect, type Shape } from '../core/device-shape';
import { requiresSupply, type DeviceBehaviorFactory } from '../core/device-simulation';
import { u } from '../core/device-metrics';

function frameReceiver(
  pins: Readonly<Record<string, string>>,
  protocol: string,
  minimumVolts: number,
): DeviceBehaviorFactory {
  return requiresSupply(
    () => ({
      update(context) {
        const message = readBusFrame(context, pins, protocol);
        if (!message) return;
        for (const key of ['pixels', 'segments', 'brightness', 'enabled']) {
          const value = message.data[key];
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
            context.emit(key, value);
        }
      },
    }),
    { minimumVolts },
  );
}

export const MAX7219_MATRIX: VirtualDevice = {
  id: 'max7219-matrix',
  name: 'MAX7219 LED matrix 8x8',
  model: 'MAX7219',
  description: 'จุด LED 8×8 สำหรับแสดงรูปและสถานะ',
  x: 0,
  y: 0,
  ...moduleBoard(
    32,
    32,
    'MAX7219 8x8',
    [
      ['VCC', 'vcc'],
      ['GND', 'gnd'],
      ['DIN', 'digital', 'input'],
      ['CS', 'digital', 'input'],
      ['CLK', 'digital', 'input'],
    ],
    (context) => {
      const pixels = stringState(context, 'pixels', '0'.repeat(64));
      const on =
        context.running && context.state['powered'] === true && context.state['enabled'] === true;
      return [
        rect(u(2), u(6), u(28), u(23), { fill: '#111' }),
        ...Array.from({ length: 64 }, (_, index) =>
          circle(u(4.5 + (index % 8) * 3.3), u(7.7 + Math.floor(index / 8) * 2.8), u(1), {
            fill: on && pixels[index] === '1' ? '#ff3030' : '#301515',
            opacity: on ? 0.2 + numberState(context, 'brightness', 8) / 20 : 1,
          }),
        ),
      ];
    },
  ),
  operatingVoltage: { min: 4, max: 5.5, recommended: 5 },
  interfaces: ['digital', 'power'],
  simulation: frameReceiver({ data: 'DIN', select: 'CS', clock: 'CLK' }, 'max7219-frame', 4),
  catalog: {
    categoryId: 'displays',
    category: 'Displays',
    aliases: ['led matrix', 'dot matrix', '8x8', 'จอเมทริกซ์'],
    tags: ['display', 'max7219', 'matrix'],
    interfaceLabel: 'DIN / CS / CLK',
    typicalUsage: 'แสดงสัญลักษณ์และสถานะอุปกรณ์',
  },
};

const SEGMENTS = [
  [1, 0, 4, 0.8],
  [5, 1, 0.8, 4],
  [5, 6, 0.8, 4],
  [1, 10.2, 4, 0.8],
  [0, 6, 0.8, 4],
  [0, 1, 0.8, 4],
  [1, 5.1, 4, 0.8],
];
export const TM1637_DISPLAY: VirtualDevice = {
  id: 'tm1637-display',
  name: 'TM1637 seven-segment display',
  model: 'TM1637 4-digit',
  description: 'จอเลข 4 หลัก สำหรับนาฬิกาและตัวนับ',
  x: 0,
  y: 0,
  ...moduleBoard(
    42,
    24,
    'TM1637',
    [
      ['VCC', 'vcc'],
      ['GND', 'gnd'],
      ['CLK', 'digital', 'input'],
      ['DIO', 'digital', 'bidirectional'],
    ],
    (context) => {
      const digits = stringState(context, 'segments', '0,0,0,0').split(',').map(Number);
      const on =
        context.running && context.state['powered'] === true && context.state['enabled'] === true;
      const shapes: Shape[] = [rect(u(2), u(6), u(38), u(15), { fill: '#111' })];
      for (let digit = 0; digit < 4; digit++) {
        SEGMENTS.forEach(([x, y, w, h], bit) =>
          shapes.push(
            rect(u(4 + digit * 9 + x), u(8 + y), u(w), u(h), {
              fill: on && (digits[digit] & (1 << bit)) !== 0 ? '#ff3030' : '#321818',
              rx: u(0.2),
            }),
          ),
        );
        shapes.push(
          circle(u(11 + digit * 9), u(18.5), u(0.45), {
            fill: on && (digits[digit] & 128) !== 0 ? '#ff3030' : '#321818',
          }),
        );
      }
      return shapes;
    },
  ),
  operatingVoltage: { min: 3.3, max: 5.5, recommended: 5 },
  interfaces: ['digital', 'power'],
  simulation: frameReceiver({ data: 'DIO', clock: 'CLK' }, 'tm1637-frame', 3.3),
  catalog: {
    categoryId: 'displays',
    category: 'Displays',
    aliases: ['seven segment', '7 segment', '7-segment', 'จอเลข'],
    tags: ['display', 'tm1637', 'clock', 'counter'],
    interfaceLabel: 'CLK / DIO (not I2C)',
    typicalUsage: 'นับวัตถุด้วย IR และแสดงเวลาจาก RTC',
  },
};
