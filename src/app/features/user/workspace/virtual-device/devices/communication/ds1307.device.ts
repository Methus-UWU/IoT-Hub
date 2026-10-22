import type { VirtualDevice } from '../../models/virtual-device.model';
import { moduleBoard } from '../core/module-board';
import { publishBus, readBusFrame } from '../core/multi-pin-bus';
import { propertyNumber, requiresSupply } from '../core/device-simulation';
import { circle, rect } from '../core/device-shape';
import { u } from '../core/device-metrics';

export const DS1307: VirtualDevice = {
  id: 'rtc-ds1307',
  name: 'DS1307 real-time clock',
  model: 'DS1307',
  description: 'นาฬิกา RTC ผ่าน I2C สำหรับแสดงเวลาและตั้งเวลา',
  x: 0,
  y: 0,
  ...moduleBoard(
    28,
    28,
    'DS1307 RTC',
    [
      ['VCC', 'vcc'],
      ['GND', 'gnd'],
      ['SDA', 'i2c-sda'],
      ['SCL', 'i2c-scl'],
      ['SQW', 'digital', 'output'],
    ],
    () => [
      circle(u(14), u(15), u(8), { fill: '#bbb', stroke: '#555', strokeWidth: u(1) }),
      rect(u(2), u(7), u(4), u(7), { fill: '#222' }),
    ],
  ),
  operatingVoltage: { min: 4.5, max: 5.5, recommended: 5 },
  interfaces: ['i2c', 'power'],
  i2cAddress: { fallback: '0x68' },
  properties: [
    {
      id: 'epoch',
      label: 'เวลาเริ่มต้น (Unix UTC)',
      kind: 'number',
      defaultValue: 1789430400,
      min: 946684800,
      max: 4102444799,
      step: 1,
    },
  ],
  simulation: requiresSupply(
    () => {
      let elapsed = 0;
      let adjusted: number | undefined;
      let lastCommand: string | number | boolean | readonly string[] | undefined;
      const pins = { data: 'SDA', clock: 'SCL' };
      return {
        drive(context) {
          publishBus(context, pins, 'ds1307', {
            busKey: '0x68',
            epoch:
              (adjusted ?? propertyNumber(context, 'epoch', 1789430400)) +
              Math.floor(elapsed / 1000),
            running: true,
          });
          context.publish('SDA', 'i2c-device', { chip: 'ds1307', address: '0x68' });
        },
        update(context) {
          const command = readBusFrame(context, pins, 'ds1307-adjust');
          if (
            command &&
            command.data['sequence'] !== lastCommand &&
            typeof command.data['epoch'] === 'number'
          ) {
            adjusted = command.data['epoch'];
            elapsed = 0;
            lastCommand = command.data['sequence'];
          }
          elapsed += context.deltaMs;
          context.emit(
            'epoch',
            (adjusted ?? propertyNumber(context, 'epoch', 1789430400)) + Math.floor(elapsed / 1000),
          );
        },
        reset() {
          elapsed = 0;
          adjusted = undefined;
          lastCommand = undefined;
        },
      };
    },
    { minimumVolts: 4.5 },
  ),
  readings: [{ id: 'epoch', label: 'เวลา Unix UTC' }],
  catalog: {
    categoryId: 'communication',
    category: 'Communication',
    aliases: ['rtc', 'ds1307', 'clock', 'นาฬิกา'],
    tags: ['rtc', 'i2c', 'time'],
    interfaceLabel: 'I2C · 0x68',
    typicalUsage: 'นาฬิกาดิจิทัลและบันทึกเวลา',
  },
};
