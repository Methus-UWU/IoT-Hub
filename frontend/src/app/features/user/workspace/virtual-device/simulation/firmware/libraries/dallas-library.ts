import { FirmwareRuntimeError, isLibraryObject, numeric, truthy } from '../firmware-values';
import { accept, libraryObject, requirePin, type LibraryDefinition } from './library-support';

/** What the DallasTemperature library returns for a probe that does not answer. */
const DEVICE_DISCONNECTED_C = -127;

interface OneWireBus {
  readonly pinName: string;
}

/**
 * OneWire + DallasTemperature: `OneWire bus(4); DallasTemperature sensors(&bus);`.
 *
 * Every DS18B20 on the bus pin answers, in the order the solver saw them, so
 * `getTempCByIndex(0)` is the first probe on the wire. With none there the
 * library's own "disconnected" value, -127, comes back, which is the number a
 * sketch is expected to check for.
 */
export const DALLAS_LIBRARY: LibraryDefinition = {
  constants: { DEVICE_DISCONNECTED_C, DEVICE_DISCONNECTED_F: -196.6 },
  classes: {
    OneWire: (args, host, line) => {
      const pinName = requirePin(host, args[0], 'OneWire', line);
      return libraryObject('OneWire', { reset: () => 1, reset_search: accept }, { pinName });
    },
    DallasTemperature: (args, host, line) => {
      const bus = args[0];
      if (!isLibraryObject(bus) || bus.className !== 'OneWire') {
        throw new FirmwareRuntimeError(
          'DallasTemperature ต้องสร้างจาก OneWire เช่น DallasTemperature sensors(&oneWire)',
          line,
        );
      }
      const pinName = (bus as unknown as OneWireBus).pinName;
      const probes = () =>
        host
          .messages(pinName)
          .filter((message) => message.protocol === 'ds18b20')
          .map((message) => message.data['temperature'])
          .filter((value): value is number => typeof value === 'number');
      const celsius = (index: number) => probes()[index] ?? DEVICE_DISCONNECTED_C;

      return libraryObject('DallasTemperature', {
        begin: accept,
        requestTemperatures: accept,
        setResolution: accept,
        setWaitForConversion: accept,
        isConversionComplete: () => true,
        getDeviceCount: () => probes().length,
        getDS18Count: () => probes().length,
        getTempCByIndex: (callArgs, callLine) => celsius(numeric(callArgs[0], callLine)),
        getTempFByIndex: (callArgs, callLine) => {
          const value = celsius(numeric(callArgs[0], callLine));
          return value === DEVICE_DISCONNECTED_C ? -196.6 : (value * 9) / 5 + 32;
        },
        isParasitePowerMode: () => false,
        setCheckForConversion: (callArgs) => (truthy(callArgs[0]) ? 1 : 0),
      });
    },
  },
};
