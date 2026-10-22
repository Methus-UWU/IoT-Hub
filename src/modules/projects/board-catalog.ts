/**
 * Boards a project can be created with.
 *
 * This is product catalog, not user data, so it lives in code rather than a table.
 * The backend needs it to reject a definition id it does not recognise, to place
 * the board component when a project is created, and to write the starter files
 * for the chosen framework.
 *
 * Geometry — outline, pin names, pin positions, capabilities — deliberately stays
 * in the frontend component definitions. Duplicating it here would create a second
 * source of truth that drifts, and the backend has no use for it.
 *
 * `id` must match the frontend catalog key exactly.
 */

import { findDevice } from './catalog/device-catalog';

/**
 * Framework labels. They are what the create dialog offers and what a project
 * stores; the files that make each one true come from `project-starter-files.ts`.
 */
export const PLATFORMIO = 'PlatformIO';
export const ARDUINO_CPP = 'Arduino C++';
export const MICROPYTHON = 'MicroPython';

/**
 * How the browser writes a built image to the board over Web Serial.
 *
 * - `esptool`: Espressif ROM bootloader (esptool-js); images at fixed offsets.
 * - `stk500v1`: Arduino optiboot / old bootloader; one Intel HEX image.
 * - `stk500v2`: Arduino Mega wiring bootloader. Built, but not flashed from the
 *   browser yet — the client offers the .hex as a download instead.
 */
export type FlashProtocol = 'esptool' | 'stk500v1' | 'stk500v2';

export interface FlashMethod {
  readonly protocol: FlashProtocol;
  readonly baudRate: number;
}

export interface BoardDefinition {
  readonly id: string;
  readonly name: string;
  /** Frameworks a project on this board may use, the default first. */
  readonly frameworks: readonly string[];
  /** `frameworks[0]`, kept as its own field for clients that read only it. */
  readonly defaultFramework: string;
  /**
   * PlatformIO target written to the project's `platformio.ini`. Absent for boards
   * PlatformIO does not build (MicroPython).
   */
  readonly platformio?: {
    readonly platform: string;
    readonly board: string;
  };
  /**
   * Present only on boards the firmware builder can compile — the platform and
   * board must be installed in `build-worker/builder/targets.json`, because a
   * build runs with no network and cannot fetch anything.
   */
  readonly flash?: FlashMethod;
}

/** A board programmed in Arduino C++, either through PlatformIO or as a sketch. */
function arduinoBoard(
  id: string,
  name: string,
  platform: string,
  board: string,
  flash?: FlashMethod,
): BoardDefinition {
  return {
    id,
    name,
    frameworks: [PLATFORMIO, ARDUINO_CPP],
    defaultFramework: PLATFORMIO,
    platformio: { platform, board },
    ...(flash ? { flash } : {}),
  };
}

const ESPTOOL: FlashMethod = { protocol: 'esptool', baudRate: 460_800 };
const OPTIBOOT: FlashMethod = { protocol: 'stk500v1', baudRate: 115_200 };

export const BOARD_DEFINITIONS: readonly BoardDefinition[] = [
  arduinoBoard(
    'esp32-devkit-v1',
    'ESP32 DevKit V1 (30-pin)',
    'espressif32',
    'esp32doit-devkit-v1',
    ESPTOOL,
  ),
  arduinoBoard(
    'esp32-devkit-38',
    'ESP32 DevKit (38-pin)',
    'espressif32',
    'esp32dev',
    ESPTOOL,
  ),
  arduinoBoard('esp32-cam', 'ESP32-CAM', 'espressif32', 'esp32cam', ESPTOOL),
  arduinoBoard(
    'esp32-wroom-32',
    'ESP32-WROOM-32',
    'espressif32',
    'esp32dev',
    ESPTOOL,
  ),
  arduinoBoard(
    'esp32-s3-devkitc-1',
    'ESP32-S3',
    'espressif32',
    'esp32-s3-devkitc-1',
  ),
  arduinoBoard(
    'esp8266-nodemcu',
    'ESP8266 NodeMCU',
    'espressif8266',
    'nodemcuv2',
  ),
  arduinoBoard('arduino-uno-r3', 'Arduino Uno R3', 'atmelavr', 'uno', OPTIBOOT),
  // PlatformIO's `nanoatmega328` is the old bootloader, which runs at 57600.
  arduinoBoard('arduino-nano', 'Arduino Nano', 'atmelavr', 'nanoatmega328', {
    protocol: 'stk500v1',
    baudRate: 57_600,
  }),
  arduinoBoard(
    'arduino-mega-2560',
    'Arduino Mega 2560',
    'atmelavr',
    'megaatmega2560',
    { protocol: 'stk500v2', baudRate: 115_200 },
  ),
  {
    id: 'pico-w',
    name: 'Raspberry Pi Pico W',
    frameworks: [MICROPYTHON],
    defaultFramework: MICROPYTHON,
  },
];

const BY_ID = new Map(BOARD_DEFINITIONS.map((board) => [board.id, board]));

/** New projects need a drawable board with a pinout; legacy ids remain readable. */
export const CREATABLE_BOARD_DEFINITIONS = BOARD_DEFINITIONS.filter(
  (board) => findDevice(board.id)?.isBoard,
);

export function findBoard(id: string): BoardDefinition | undefined {
  return BY_ID.get(id);
}

/**
 * A board by catalog id, or by the display name a project stores in
 * `projects.board` (`ESP32 DevKit V1 (30-pin)`). Prefer the board component on
 * the canvas, which always carries the id; this is for a project without one.
 */
export function findBoardByIdOrName(
  value: string,
): BoardDefinition | undefined {
  return (
    BY_ID.get(value) ?? BOARD_DEFINITIONS.find((board) => board.name === value)
  );
}

export function isKnownBoard(id: string): boolean {
  return BY_ID.has(id);
}
