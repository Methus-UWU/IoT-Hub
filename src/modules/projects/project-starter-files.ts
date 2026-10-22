/**
 * Files a new project starts with, by framework.
 *
 * - PlatformIO: a standard PlatformIO project — `platformio.ini` at the root and
 *   the sketch at `src/main.cpp`.
 * - Arduino C++: an Arduino IDE sketch, `main.ino`.
 *
 * The IDE, the simulator and the assistant then all edit one real entry point
 * rather than each inventing its own.
 *
 * The content is generated from catalog data only — board target and library
 * ids — never from user input, so nothing a user types can reach the build
 * configuration through this path.
 */

import { ARDUINO_CPP, BoardDefinition, PLATFORMIO } from './board-catalog';
import { libraryFor } from './catalog/device-catalog';
import {
  assertFileWithinSizeLimit,
  hashFileContent,
} from './project-file-path';
import { CreateFileInput } from './project.repository';

export const PLATFORMIO_CONFIG_PATH = 'platformio.ini';
export const PLATFORMIO_MAIN_PATH = 'src/main.cpp';
export const ARDUINO_SKETCH_PATH = 'main.ino';

/** Matches `Serial.begin` in the starter sketch, so the monitor reads it. */
const MONITOR_SPEED = 115200;

const SETUP_LOOP = `void setup() {
  Serial.begin(${MONITOR_SPEED});
}

void loop() {
}
`;

/**
 * Starter files for a board, the framework chosen for it, and the peripherals it
 * was created with.
 *
 * A framework with no starter here (MicroPython) gets none; the editor and the
 * assistant already handle a project with no files.
 */
export function starterFilesFor(
  board: BoardDefinition,
  framework: string,
  deviceIds: readonly string[],
): CreateFileInput[] {
  if (framework === PLATFORMIO && board.platformio) {
    return [
      toFileInput(
        PLATFORMIO_CONFIG_PATH,
        platformioConfig(board, board.platformio, deviceIds),
      ),
      // Plain C++ needs the Arduino header an .ino gets implicitly.
      toFileInput(
        PLATFORMIO_MAIN_PATH,
        `#include <Arduino.h>\n\n${SETUP_LOOP}`,
      ),
    ];
  }

  if (framework === ARDUINO_CPP) {
    return [toFileInput(ARDUINO_SKETCH_PATH, SETUP_LOOP)];
  }

  return [];
}

function platformioConfig(
  board: BoardDefinition,
  target: NonNullable<BoardDefinition['platformio']>,
  deviceIds: readonly string[],
): string {
  const libraries = [
    ...new Set(
      deviceIds
        .map((id) => libraryFor(id)?.platformio)
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ];

  return [
    `; PlatformIO project configuration for ${board.name}`,
    '; https://docs.platformio.org/page/projectconf.html',
    '',
    `[env:${board.id}]`,
    `platform = ${target.platform}`,
    `board = ${target.board}`,
    'framework = arduino',
    `monitor_speed = ${MONITOR_SPEED}`,
    ...(libraries.length
      ? ['lib_deps =', ...libraries.map((entry) => `    ${entry}`)]
      : []),
    '',
  ].join('\n');
}

function toFileInput(path: string, content: string): CreateFileInput {
  return {
    path,
    content,
    contentHash: hashFileContent(content),
    sizeBytes: assertFileWithinSizeLimit(content),
  };
}
