import { UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import {
  ARDUINO_CPP,
  BoardDefinition,
  FlashMethod,
  PLATFORMIO,
  findBoard,
} from '../projects/board-catalog';

/**
 * What a build compiles, decided from the project and its files.
 *
 * Pure: no I/O, so the rules for which files reach the compiler are tested
 * without a database. The builder image applies its own allowlist again; this is
 * where the product decides, the image is where it is enforced.
 */

export interface BuildSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface BuildPlan {
  readonly boardId: string;
  readonly platform: string;
  readonly platformBoard: string;
  readonly files: readonly BuildSourceFile[];
  /** Same sources for the same target always hash the same, so a rebuild can be skipped. */
  readonly sourceHash: string;
}

export interface BuildableBoard {
  readonly board: BoardDefinition;
  readonly platform: string;
  readonly platformBoard: string;
  readonly flash: FlashMethod;
}

export interface FlashImageLayout {
  readonly name: ArtifactName;
  /** ESP32 flash address; null for a HEX image, which carries its own addresses. */
  readonly offset: number | null;
}

export const ARTIFACT_NAMES = [
  'bootloader.bin',
  'partitions.bin',
  'boot_app0.bin',
  'firmware.bin',
  'firmware.hex',
] as const;

export type ArtifactName = (typeof ARTIFACT_NAMES)[number];

/**
 * The images each platform must produce, and where they go.
 *
 * Offsets are the Arduino-ESP32 layout for the classic ESP32, the only Espressif
 * chip the builder installs. They are decided here rather than taken from the
 * worker, because the worker's output is shaped by user code.
 */
const FLASH_LAYOUTS: Readonly<Record<string, readonly FlashImageLayout[]>> = {
  espressif32: [
    { name: 'bootloader.bin', offset: 0x1000 },
    { name: 'partitions.bin', offset: 0x8000 },
    { name: 'boot_app0.bin', offset: 0xe000 },
    { name: 'firmware.bin', offset: 0x10000 },
  ],
  atmelavr: [{ name: 'firmware.hex', offset: null }],
};

/** PlatformIO project folders that hold source. `platformio.ini` is never sent. */
const PLATFORMIO_SOURCE_ROOTS = ['src/', 'include/', 'lib/'];

/** Files an Arduino sketch compiles, which PlatformIO expects under `src/`. */
const SKETCH_SOURCE = /\.(ino|pde|c|cc|cpp|cxx|h|hh|hpp|hxx|s)$/i;

export function flashLayoutFor(platform: string): readonly FlashImageLayout[] {
  return FLASH_LAYOUTS[platform] ?? [];
}

/** The board, or a refusal that says why this project cannot be built. */
export function buildableBoard(boardId: string): BuildableBoard {
  const board = findBoard(boardId);
  if (
    !board?.platformio ||
    !board.flash ||
    !FLASH_LAYOUTS[board.platformio.platform]
  ) {
    throw new UnprocessableEntityException({
      code: 'BUILD_NOT_SUPPORTED',
      message: 'Firmware builds are not available for this board yet.',
    });
  }

  return {
    board,
    platform: board.platformio.platform,
    platformBoard: board.platformio.board,
    flash: board.flash,
  };
}

export function planBuild(
  project: { readonly board: string; readonly framework: string },
  files: readonly BuildSourceFile[],
): BuildPlan {
  const target = buildableBoard(project.board);
  const sources = sourcesFor(project.framework, files);

  if (!sources.some((file) => SKETCH_SOURCE.test(file.path))) {
    throw new UnprocessableEntityException({
      code: 'BUILD_NO_SOURCES',
      message:
        project.framework === PLATFORMIO
          ? 'Add a source file under src/ before building.'
          : 'Add a sketch (.ino or .cpp) before building.',
    });
  }

  return {
    boardId: target.board.id,
    platform: target.platform,
    platformBoard: target.platformBoard,
    files: sources,
    sourceHash: hashSources(target, sources),
  };
}

function sourcesFor(
  framework: string,
  files: readonly BuildSourceFile[],
): BuildSourceFile[] {
  const isPlatformioSource = (path: string) =>
    PLATFORMIO_SOURCE_ROOTS.some((root) => path.startsWith(root));

  if (framework === PLATFORMIO) {
    return files
      .filter((file) => isPlatformioSource(file.path))
      .map(({ path, content }) => ({ path, content }));
  }

  if (framework === ARDUINO_CPP) {
    // A sketch keeps its files beside main.ino; PlatformIO wants them in src/.
    return files.flatMap(({ path, content }) => {
      if (isPlatformioSource(path)) return [{ path, content }];
      if (!path.includes('/') && SKETCH_SOURCE.test(path)) {
        return [{ path: `src/${path}`, content }];
      }
      return [];
    });
  }

  throw new UnprocessableEntityException({
    code: 'BUILD_NOT_SUPPORTED',
    message: `Firmware builds are not available for ${framework || 'this framework'}.`,
  });
}

function hashSources(
  target: BuildableBoard,
  files: readonly BuildSourceFile[],
): string {
  const sha256 = (value: string) =>
    createHash('sha256').update(value, 'utf8').digest('hex');
  // Paths cannot contain NUL or newline, and contents enter only as digests, so
  // no two different source trees can produce the same manifest.
  const manifest = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => `${file.path}\u0000${sha256(file.content)}`);
  return sha256(
    [target.platform, target.platformBoard, ...manifest].join('\n'),
  );
}
