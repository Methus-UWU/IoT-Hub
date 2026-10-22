import { numeric, truthy } from '../firmware-values';
import {
  accept,
  libraryObject,
  messageOn,
  requirePin,
  type LibraryDefinition,
} from './library-support';

/**
 * Adafruit "DHT sensor library": `DHT dht(pin, DHT22); dht.readTemperature()`.
 *
 * The reading is whatever the DHT part on that pin publishes — its inspector
 * values — so turning the temperature slider changes what the sketch reads. With
 * no powered DHT on the pin the library returns NaN, exactly as the real one does
 * when the sensor does not answer.
 */
export const DHT_LIBRARY: LibraryDefinition = {
  constants: { DHT11: 11, DHT12: 12, DHT21: 21, DHT22: 22, AM2301: 21 },
  classes: {
    DHT: (args, host, line) => {
      const pinName = requirePin(host, args[0], 'DHT', line);
      const reading = (key: 'temperature' | 'humidity'): number => {
        const value = messageOn(host, pinName, 'dht')?.data[key];
        return typeof value === 'number' ? value : Number.NaN;
      };
      const toFahrenheit = (celsius: number) => (celsius * 9) / 5 + 32;

      return libraryObject('DHT', {
        begin: accept,
        readTemperature: (callArgs) => {
          const celsius = reading('temperature');
          return truthy(callArgs[0]) ? toFahrenheit(celsius) : celsius;
        },
        readHumidity: () => reading('humidity'),
        convertCtoF: (callArgs, callLine) => toFahrenheit(numeric(callArgs[0], callLine)),
        convertFtoC: (callArgs, callLine) => ((numeric(callArgs[0], callLine) - 32) * 5) / 9,
        computeHeatIndex: (callArgs, callLine) => {
          const fahrenheitIn = callArgs[2] === undefined || truthy(callArgs[2]);
          const t = numeric(callArgs[0], callLine);
          const rh = numeric(callArgs[1], callLine);
          const f = fahrenheitIn ? t : toFahrenheit(t);
          const index = heatIndexF(f, rh);
          return fahrenheitIn ? index : ((index - 32) * 5) / 9;
        },
      });
    },
  },
};

/** NOAA's heat index, as the Adafruit library computes it. */
function heatIndexF(t: number, rh: number): number {
  const simple = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094);
  if (simple <= 79) return simple;
  let hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * rh -
    0.22475541 * t * rh -
    0.00683783 * t * t -
    0.05481717 * rh * rh +
    0.00122874 * t * t * rh +
    0.00085282 * t * rh * rh -
    0.00000199 * t * t * rh * rh;
  if (rh < 13 && t >= 80 && t <= 112) {
    hi -= (13 - rh) * 0.25 * Math.sqrt((17 - Math.abs(t - 95)) * 0.05882);
  } else if (rh > 85 && t >= 80 && t <= 87) {
    hi += (rh - 85) * 0.1 * ((87 - t) * 0.2);
  }
  return hi;
}
