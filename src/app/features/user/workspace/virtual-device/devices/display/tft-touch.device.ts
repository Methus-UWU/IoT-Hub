import type { VirtualDevice } from '../../models/virtual-device.model';
import { moduleBoard } from '../core/module-board';
import { publishBus, readBusFrame } from '../core/multi-pin-bus';
import { propertyBoolean, propertyNumber, requiresSupply } from '../core/device-simulation';
import { rect, text } from '../core/device-shape';
import { stringState } from '../core/device-definition';
import { u } from '../core/device-metrics';

export const TFT_TOUCH: VirtualDevice = {
  id: 'tft-ili9341-touch',
  name: 'ILI9341 TFT touchscreen 2.8"',
  model: 'ILI9341 + XPT2046',
  description: 'จอสี 240×320 พร้อมระบบสัมผัสแบบ resistive ผ่าน SPI',
  x: 0,
  y: 0,
  ...moduleBoard(
    50,
    86,
    'ILI9341 + XPT2046',
    [
      ['VCC', 'vcc'],
      ['GND', 'gnd'],
      ['CS', 'spi-cs', 'input'],
      ['RST', 'reset', 'input'],
      ['DC', 'digital', 'input'],
      ['MOSI', 'spi-mosi', 'input'],
      ['SCK', 'spi-sck', 'input'],
      ['LED', 'vcc'],
      ['MISO', 'spi-miso', 'output'],
      ['T_CLK', 'spi-sck', 'input'],
      ['T_CS', 'spi-cs', 'input'],
      ['T_DIN', 'spi-mosi', 'input'],
      ['T_DO', 'spi-miso', 'output'],
      ['T_IRQ', 'digital', 'output'],
    ],
    (context) => {
      const powered =
        context.running && context.state['powered'] === true && context.state['backlight'] === true;
      const lines = stringState(context, 'screen', '').split('\n');
      return [
        rect(u(1), u(10), u(48), u(64), {
          fill: powered ? stringState(context, 'background', '#000000') : '#16191d',
          rx: u(1),
        }),
        ...(powered
          ? lines
              .slice(0, 40)
              .map((line, index) =>
                text(u(1.5), u(11.3 + index * 1.6), line.slice(0, 40), {
                  size: u(1.4),
                  fill: stringState(context, 'foreground', '#ffffff'),
                  mono: true,
                }),
              )
          : []),
      ];
    },
  ),
  operatingVoltage: { min: 3.0, max: 3.6, recommended: 3.3 },
  interfaces: ['spi', 'power'],
  properties: [
    {
      id: 'touched',
      label: 'สัมผัสหน้าจอ',
      kind: 'boolean',
      defaultValue: false,
      simulationOnly: true,
    },
    {
      id: 'touchX',
      label: 'สัมผัส X (raw)',
      kind: 'number',
      defaultValue: 2048,
      min: 0,
      max: 4095,
      simulationOnly: true,
    },
    {
      id: 'touchY',
      label: 'สัมผัส Y (raw)',
      kind: 'number',
      defaultValue: 2048,
      min: 0,
      max: 4095,
      simulationOnly: true,
    },
  ],
  simulation: requiresSupply(
    () => ({
      drive(context) {
        publishBus(
          context,
          { select: 'T_CS', clock: 'T_CLK', mosi: 'T_DIN', miso: 'T_DO' },
          'xpt2046',
          {
            touched: propertyBoolean(context, 'touched'),
            x: propertyNumber(context, 'touchX', 2048),
            y: propertyNumber(context, 'touchY', 2048),
          },
        );
      },
      update(context) {
        const led = context.readNode('LED');
        context.emit('backlight', !led.floating && led.voltage >= 3);
        const message = readBusFrame(
          context,
          { select: 'CS', clock: 'SCK', mosi: 'MOSI', dc: 'DC' },
          'ili9341-frame',
        );
        if (!message) return;
        for (const key of ['screen', 'background', 'foreground']) {
          const value = message.data[key];
          if (typeof value === 'string') context.emit(key, value);
        }
      },
    }),
    { minimumVolts: 3 },
  ),
  catalog: {
    categoryId: 'displays',
    category: 'Displays',
    aliases: ['touchscreen', 'touch screen', 'tft', 'จอสัมผัส'],
    tags: ['lcd', 'tft', 'ili9341', 'xpt2046', 'touch'],
    interfaceLabel: 'SPI · 3.3 V',
    typicalUsage: 'หน้าจอสถานะและปุ่มสัมผัส',
  },
};
