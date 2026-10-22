import type { VirtualDevice } from '../../models/virtual-device.model';
import { moduleBoard } from '../core/module-board';
import { publishBus } from '../core/multi-pin-bus';
import { propertyNumber, propertyString, requiresSupply } from '../core/device-simulation';
import { rect } from '../core/device-shape';
import { u } from '../core/device-metrics';

export const BME280: VirtualDevice = {
  id: 'bme280',
  name: 'BME280 environment sensor',
  model: 'BME280 I2C',
  description: 'วัดอุณหภูมิ ความชื้น และความกดอากาศ',
  x: 0,
  y: 0,
  ...moduleBoard(
    16,
    12,
    'BME280',
    [
      ['VCC', 'vcc'],
      ['GND', 'gnd'],
      ['SDA', 'i2c-sda'],
      ['SCL', 'i2c-scl'],
    ],
    () => [rect(u(6), u(5), u(4), u(3), { fill: '#aaa' })],
  ),
  operatingVoltage: { min: 1.8, max: 3.6, recommended: 3.3 },
  interfaces: ['i2c', 'power'],
  i2cAddress: { property: 'address', fallback: '0x76' },
  properties: [
    {
      id: 'address',
      label: 'ที่อยู่ I2C',
      kind: 'select',
      defaultValue: '0x76',
      options: [
        { value: '0x76', label: '0x76' },
        { value: '0x77', label: '0x77' },
      ],
    },
    {
      id: 'temperature',
      label: 'อุณหภูมิ',
      kind: 'number',
      defaultValue: 25,
      min: -40,
      max: 85,
      unit: '°C',
      simulationOnly: true,
    },
    {
      id: 'humidity',
      label: 'ความชื้น',
      kind: 'number',
      defaultValue: 50,
      min: 0,
      max: 100,
      unit: '%',
      simulationOnly: true,
    },
    {
      id: 'pressure',
      label: 'ความกดอากาศ',
      kind: 'number',
      defaultValue: 1013.25,
      min: 300,
      max: 1100,
      unit: 'hPa',
      simulationOnly: true,
    },
  ],
  simulation: requiresSupply(
    () => ({
      drive(context) {
        const address = propertyString(context, 'address', '0x76');
        publishBus(context, { data: 'SDA', clock: 'SCL' }, 'bme280', {
          busKey: address,
          address,
          temperature: propertyNumber(context, 'temperature', 25),
          humidity: propertyNumber(context, 'humidity', 50),
          pressure: propertyNumber(context, 'pressure', 1013.25) * 100,
        });
        context.publish('SDA', 'i2c-device', { chip: 'bme280', address });
      },
    }),
    { minimumVolts: 1.8 },
  ),
  catalog: {
    categoryId: 'sensors',
    category: 'Sensors',
    aliases: ['weather sensor', 'barometer', 'เซนเซอร์อากาศ'],
    tags: ['bme280', 'temperature', 'humidity', 'pressure'],
    interfaceLabel: 'I2C',
    typicalUsage: 'สถานีอากาศและตรวจสภาพแวดล้อม',
  },
};
