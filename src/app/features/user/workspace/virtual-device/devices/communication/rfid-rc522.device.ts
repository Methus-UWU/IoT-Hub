import type { VirtualDevice } from '../../models/virtual-device.model';
import { moduleBoard } from '../core/module-board';
import { publishBus } from '../core/multi-pin-bus';
import { propertyBoolean, propertyString, requiresSupply } from '../core/device-simulation';
import { rect, text } from '../core/device-shape';
import { u } from '../core/device-metrics';

export const RFID_RC522: VirtualDevice = {
  id: 'rfid-rc522',
  name: 'RFID RC522 reader',
  model: 'MFRC522',
  description: 'เครื่องอ่านบัตร RFID 13.56 MHz ผ่าน SPI',
  x: 0,
  y: 0,
  ...moduleBoard(
    40,
    60,
    'RFID RC522',
    [
      ['SDA', 'spi-cs', 'input'],
      ['SCK', 'spi-sck', 'input'],
      ['MOSI', 'spi-mosi', 'input'],
      ['MISO', 'spi-miso', 'output'],
      ['IRQ', 'digital', 'output'],
      ['GND', 'gnd'],
      ['RST', 'reset', 'input'],
      ['VCC', 'vcc'],
    ],
    (context) => [
      ...[0, 1, 2, 3].map((inset) =>
        rect(u(3 + inset), u(15 + inset), u(34 - inset * 2), u(37 - inset * 2), {
          fill: 'none',
          stroke: '#d9a95b',
          strokeWidth: u(0.4),
          rx: u(3),
        }),
      ),
      text(
        u(20),
        u(35),
        context.running && context.state['powered'] && context.state['cardPresent']
          ? 'CARD'
          : 'RFID',
        { size: u(3), anchor: 'middle', fill: '#fff' },
      ),
    ],
  ),
  operatingVoltage: { min: 2.5, max: 3.6, recommended: 3.3 },
  interfaces: ['spi', 'power'],
  properties: [
    {
      id: 'cardPresent',
      label: 'แตะบัตร',
      kind: 'boolean',
      defaultValue: false,
      simulationOnly: true,
    },
    {
      id: 'uid',
      label: 'UID (hex 4 bytes)',
      kind: 'text',
      defaultValue: 'DE AD BE EF',
      simulationOnly: true,
    },
  ],
  simulation: requiresSupply(
    () => ({
      drive(context) {
        publishBus(
          context,
          { select: 'SDA', clock: 'SCK', mosi: 'MOSI', miso: 'MISO', reset: 'RST' },
          'mfrc522',
          {
            cardPresent: propertyBoolean(context, 'cardPresent'),
            uid: propertyString(context, 'uid', 'DE AD BE EF'),
          },
        );
      },
    }),
    { minimumVolts: 2.5 },
  ),
  catalog: {
    categoryId: 'communication',
    category: 'Communication',
    aliases: ['rfid', 'rc522', 'mfrc522', 'เครื่องอ่านบัตร'],
    tags: ['rfid', 'spi', 'card'],
    interfaceLabel: 'SPI · 3.3 V',
    typicalUsage: 'ตรวจจับบัตรและทดลองระบบเข้าออก',
  },
};
