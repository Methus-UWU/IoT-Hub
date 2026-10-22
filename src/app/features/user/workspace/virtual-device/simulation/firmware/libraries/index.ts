import type { FirmwareValue, LibraryFactory, LibraryHost, LibraryObject } from '../firmware-values';
import { DALLAS_LIBRARY } from './dallas-library';
import { DHT_LIBRARY } from './dht-library';
import { LCD_I2C_LIBRARY } from './lcd-i2c-library';
import type { LibraryDefinition } from './library-support';
import { SERVO_LIBRARY } from './servo-library';
import { SSD1306_LIBRARY } from './ssd1306-library';
import { WIRE_LIBRARY } from './wire-library';
import { LED_DISPLAYS_LIBRARY } from './led-displays-library';
import { ENVIRONMENT_LIBRARY } from './environment-library';
import { SPI_LIBRARY } from './spi-library';
import { RFID_LIBRARY } from './rfid-library';
import { TOUCH_DISPLAY_LIBRARY } from './touch-display-library';
import { NETWORK_LIBRARY } from './network-library';

/**
 * Every Arduino library the simulator emulates. Adding one is adding a
 * definition here and describing it in `library-catalog.ts`, which is what the
 * assistant reads; a class not listed here is reported by name when a sketch
 * tries to build it.
 */
const LIBRARIES: readonly LibraryDefinition[] = [
  WIRE_LIBRARY,
  DHT_LIBRARY,
  SSD1306_LIBRARY,
  LCD_I2C_LIBRARY,
  SERVO_LIBRARY,
  DALLAS_LIBRARY,
  LED_DISPLAYS_LIBRARY,
  ENVIRONMENT_LIBRARY,
  SPI_LIBRARY,
  RFID_LIBRARY,
  TOUCH_DISPLAY_LIBRARY,
  NETWORK_LIBRARY,
];

export const LIBRARY_CLASSES: ReadonlyMap<string, LibraryFactory> = new Map(
  LIBRARIES.flatMap((library) => Object.entries(library.classes)),
);

export const LIBRARY_CONSTANTS: Readonly<Record<string, FirmwareValue>> = Object.assign(
  {},
  ...LIBRARIES.map((library) => library.constants ?? {}),
);

/** The objects libraries declare themselves, such as `Wire`. */
export function createLibraryGlobals(host: LibraryHost): ReadonlyMap<string, LibraryObject> {
  return new Map(
    LIBRARIES.flatMap((library) =>
      Object.entries(library.globals ?? {}).map(([name, create]) => [name, create(host)] as const),
    ),
  );
}
