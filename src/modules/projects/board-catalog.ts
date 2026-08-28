/**
 * Boards a project can be created with.
 *
 * This is product catalog, not user data, so it lives in code rather than a table.
 * The backend needs it for two reasons only: to reject a definition id it does not
 * recognise, and to place the board component when a project is created.
 *
 * Geometry — outline, pin names, pin positions, capabilities — deliberately stays
 * in the frontend component definitions. Duplicating it here would create a second
 * source of truth that drifts, and the backend has no use for it.
 *
 * `id` must match the frontend catalog key exactly.
 */

export interface BoardDefinition {
  readonly id: string;
  readonly name: string;
  /** Default framework offered for this board, used when none is chosen. */
  readonly defaultFramework: string;
}

export const BOARD_DEFINITIONS: readonly BoardDefinition[] = [
  {
    id: 'esp32-devkit-v1',
    name: 'ESP32 DevKit V1',
    defaultFramework: 'Arduino C++',
  },
  {
    id: 'esp32-s3-devkitc-1',
    name: 'ESP32-S3',
    defaultFramework: 'Arduino C++',
  },
  {
    id: 'esp8266-nodemcu',
    name: 'ESP8266 NodeMCU',
    defaultFramework: 'Arduino C++',
  },
  {
    id: 'arduino-uno-r3',
    name: 'Arduino Uno',
    defaultFramework: 'Arduino C++',
  },
  {
    id: 'arduino-nano',
    name: 'Arduino Nano',
    defaultFramework: 'Arduino C++',
  },
  {
    id: 'pico-w',
    name: 'Raspberry Pi Pico W',
    defaultFramework: 'MicroPython',
  },
] as const;

const BY_ID = new Map(BOARD_DEFINITIONS.map((board) => [board.id, board]));

export function findBoard(id: string): BoardDefinition | undefined {
  return BY_ID.get(id);
}

export function isKnownBoard(id: string): boolean {
  return BY_ID.has(id);
}
