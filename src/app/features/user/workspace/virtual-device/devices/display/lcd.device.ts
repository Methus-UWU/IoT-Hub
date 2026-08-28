import type { DeviceKind } from '../../device-library.models';
import {
  type DevicePin,
  type LcdInterface,
  type VirtualDevice,
  pinKindFor,
} from '../../models/virtual-device.model';

type LcdDeviceKind = 'lcd' | 'lcd1602parallel' | 'lcd2004parallel' | 'lcd2004i2c';

const PARALLEL_PIN_NAMES = [
  'VSS',
  'VDD',
  'VO',
  'RS',
  'RW',
  'E',
  'D0',
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'D7',
  'A',
  'K',
] as const;

interface LcdOptions {
  id: LcdDeviceKind;
  columns: 16 | 20;
  rows: 2 | 4;
  interface: LcdInterface;
  x: number;
  y: number;
  initiallyVisible?: boolean;
  description?: string;
}

function createLcdDevice(options: LcdOptions): VirtualDevice {
  const { columns, rows, interface: lcdInterface } = options;
  const width = columns === 20 ? 340 : 280;
  const height = rows === 4 ? 225 : 165;
  const isI2c = lcdInterface === 'i2c';

  const pins: readonly DevicePin[] = isI2c
    ? [
        { name: 'GND', x: 0, y: 50, kind: 'ground', side: 'left' },
        { name: 'VCC', x: 0, y: 70, kind: 'power', side: 'left' },
        { name: 'SDA', x: 0, y: 90, kind: 'signal', side: 'left' },
        { name: 'SCL', x: 0, y: 110, kind: 'signal', side: 'left' },
      ]
    : PARALLEL_PIN_NAMES.map((name, index) => ({
        name,
        x: 28 + (index * (width - 56)) / 15,
        y: height - 8,
        kind: pinKindFor(name),
        side: 'bottom' as const,
      }));

  return {
    id: options.id as DeviceKind,
    name: `LCD ${columns}x${rows}${isI2c ? ' I2C' : ''}`,
    model: `${columns === 16 ? 'LCD1602' : 'LCD2004'}${isI2c ? ' + PCF8574' : ' / HD44780'}`,
    description:
      options.description ??
      `${columns}x${rows} HD44780-compatible character display using ${
        isI2c ? 'an I2C backpack' : 'the parallel data bus'
      }.`,
    x: options.x,
    y: options.y,
    width,
    height,
    initiallyVisible: options.initiallyVisible ?? false,
    lcdConfig: {
      columns,
      rows,
      interface: lcdInterface,
      columnIndexes: Array.from({ length: columns }, (_, index) => index),
      rowIndexes: Array.from({ length: rows }, (_, index) => index),
    },
    pins,
    catalog: {
      categoryId: 'displays',
      category: 'Displays',
      aliases: isI2c
        ? [`${columns}0${rows} display`, `${columns} by ${rows} LCD`, 'I2C screen']
        : [`${columns}0${rows} display`, `${columns} by ${rows} LCD`, 'parallel LCD'],
      tags: [
        'lcd',
        'screen',
        'display',
        'character',
        'HD44780',
        ...(isI2c ? ['I2C', 'PCF8574', 'data'] : ['parallel', 'digital']),
      ],
      interfaceLabel: isI2c ? 'I2C · 4 ขา' : 'พาราเลล 8 บิต · 16 ขา',
      typicalUsage: isI2c
        ? 'Status screens and live readouts with minimal controller pin usage.'
        : 'Character interfaces where direct GPIO control is preferred.',
    },
  };
}

export const LCD_1602_I2C = createLcdDevice({
  id: 'lcd',
  columns: 16,
  rows: 2,
  interface: 'i2c',
  x: 46,
  y: 58,
  initiallyVisible: true,
  description: 'Displays live sensor values over the I2C bus.',
});

export const LCD_1602_PARALLEL = createLcdDevice({
  id: 'lcd1602parallel',
  columns: 16,
  rows: 2,
  interface: 'parallel',
  x: 36,
  y: 52,
});

export const LCD_2004_PARALLEL = createLcdDevice({
  id: 'lcd2004parallel',
  columns: 20,
  rows: 4,
  interface: 'parallel',
  x: 26,
  y: 44,
});

export const LCD_2004_I2C = createLcdDevice({
  id: 'lcd2004i2c',
  columns: 20,
  rows: 4,
  interface: 'i2c',
  x: 56,
  y: 54,
});
