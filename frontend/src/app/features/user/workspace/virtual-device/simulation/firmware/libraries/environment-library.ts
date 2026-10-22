import {
  FirmwareRuntimeError,
  isLibraryObject,
  numeric,
  type LibraryObject,
} from '../firmware-values';
import { hexAddress, libraryObject, type LibraryDefinition } from './library-support';
import { busReply, i2cBus, sendBus } from './multi-pin-library';

function dateTime(epoch: number): LibraryObject {
  const date = new Date(epoch * 1000);
  return libraryObject('DateTime', {
    unixtime: () => Math.floor(epoch),
    year: () => date.getUTCFullYear(),
    month: () => date.getUTCMonth() + 1,
    day: () => date.getUTCDate(),
    hour: () => date.getUTCHours(),
    minute: () => date.getUTCMinutes(),
    second: () => date.getUTCSeconds(),
    dayOfTheWeek: () => date.getUTCDay(),
  });
}

export const ENVIRONMENT_LIBRARY: LibraryDefinition = {
  classes: {
    DateTime: (args, _host, line) => {
      if (args.length === 0) return dateTime(946684800);
      if (args.length === 1 && typeof args[0] === 'number') return dateTime(args[0]);
      if (args.length < 3 || args.some((arg) => typeof arg !== 'number'))
        throw new FirmwareRuntimeError(
          'DateTime รองรับ Unix timestamp หรือ year, month, day, hour, minute, second',
          line,
        );
      return dateTime(
        Date.UTC(
          numeric(args[0], line),
          numeric(args[1], line) - 1,
          numeric(args[2], line),
          numeric(args[3], line),
          numeric(args[4], line),
          numeric(args[5], line),
        ) / 1000,
      );
    },
    RTC_DS1307: (_args, host) => {
      let sequence = 0;
      const reply = () => busReply(host, i2cBus(host), 'ds1307');
      return libraryObject('RTC_DS1307', {
        begin: () => !!reply(),
        isrunning: () => !!reply(),
        now: (_a, line) => {
          const value = reply()?.data['epoch'];
          if (typeof value !== 'number')
            throw new FirmwareRuntimeError('DS1307 ไม่ตอบกลับ ตรวจไฟและ SDA/SCL', line);
          return dateTime(value);
        },
        adjust: (a, line) => {
          if (!isLibraryObject(a[0]) || a[0].className !== 'DateTime')
            throw new FirmwareRuntimeError('RTC.adjust ต้องรับ DateTime', line);
          return sendBus(host, i2cBus(host), 'ds1307-adjust', {
            epoch: numeric(a[0].call('unixtime', [], line), line),
            sequence: ++sequence,
          });
        },
      });
    },
    Adafruit_BME280: (_args, host) => {
      let address = '0x77';
      const reading = () => {
        const reply = busReply(host, i2cBus(host), 'bme280', address);
        return reply?.data['address'] === address ? reply : undefined;
      };
      const number = (key: string): number => {
        const value = reading()?.data[key];
        return typeof value === 'number' ? value : NaN;
      };
      return libraryObject('Adafruit_BME280', {
        begin: (a, l) => {
          address = hexAddress(numeric(a[0] ?? 0x77, l));
          return !!reading();
        },
        readTemperature: () => number('temperature'),
        readHumidity: () => number('humidity'),
        readPressure: () => number('pressure'),
        readAltitude: (a, l) =>
          44330 * (1 - Math.pow(number('pressure') / 100 / numeric(a[0], l), 0.1903)),
      });
    },
  },
};
