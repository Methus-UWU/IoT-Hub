import { numeric } from '../firmware-values';
import { libraryObject, type LibraryDefinition } from './library-support';

/** The transport used by the emulated SPI peripherals; raw transfer is refused. */
export const SPI_LIBRARY: LibraryDefinition = {
  classes: {},
  globals: {
    SPI: (host) =>
      libraryObject('SPIClass', {
        begin: (args, line) => {
          if (args.length >= 3)
            host.setSpiPins(
              host.pinName(numeric(args[0], line)),
              host.pinName(numeric(args[1], line)),
              host.pinName(numeric(args[2], line)),
            );
          return 0;
        },
      }),
  },
};
