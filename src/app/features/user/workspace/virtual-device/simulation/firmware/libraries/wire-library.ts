import { numeric } from '../firmware-values';
import { accept, hexAddress, libraryObject, type LibraryDefinition } from './library-support';

/**
 * `Wire` — the I2C bus. `Wire.begin(sda, scl)` moves the bus to other pins, which
 * decides where a display must be wired to be found. An address scan
 * (`beginTransmission` + `endTransmission`) answers 0 for a part that announces
 * itself on SDA and 2 (NACK) otherwise, so an I2C scanner sketch works.
 */
export const WIRE_LIBRARY: LibraryDefinition = {
  classes: {},
  globals: {
    Wire: (host) => {
      let address = -1;
      return libraryObject('TwoWire', {
        begin: (args, line) => {
          if (args.length >= 2) {
            host.setI2cPins(
              host.pinName(numeric(args[0], line)),
              host.pinName(numeric(args[1], line)),
            );
          }
          return 0;
        },
        setClock: accept,
        beginTransmission: (args, line) => {
          address = numeric(args[0], line);
          return 0;
        },
        write: accept,
        endTransmission: () => {
          const sda = host.i2cPins().sda;
          if (!sda) return 4;
          const present = host
            .messages(sda)
            .some(
              (message) =>
                message.protocol === 'i2c-device' &&
                (message.data['address'] === hexAddress(address) ||
                  message.data['address'] === 'any'),
            );
          return present ? 0 : 2;
        },
        requestFrom: () => 0,
        available: () => 0,
        read: () => 0,
      });
    },
  },
};
