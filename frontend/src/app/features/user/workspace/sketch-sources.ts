import { pickEntryFile } from './project-entry-file';
import { LIBRARY_CATALOG } from './virtual-device/simulation/firmware/libraries/library-catalog';

/**
 * A multi-file sketch, joined into the one source the browser simulator runs.
 *
 * The server compile already takes every file the way Arduino IDE and PlatformIO do
 * (`build-plan.ts`): sibling `.ino` tabs, `.cpp`/`.h` files, `include/`, and `lib/`.
 * The simulator reads one source, so this joins the same files in the same order the
 * Arduino builder does — the main `.ino`, the other `.ino` tabs alphabetically, then the
 * other translation units — and pastes each project header where it is first included.
 *
 * Every output line remembers the file and line it came from, so a fault is reported
 * as `helpers.cpp:12` rather than as a line of a source the user never wrote.
 */

export interface SketchFile {
  readonly path: string;
  readonly content: string;
}

export interface SketchLocation {
  readonly file: string;
  readonly line: number;
}

export interface CombinedSketch {
  readonly entry: string;
  readonly source: string;
  /** The project file and line behind a line of `source` (1-based). */
  locate(line: number): SketchLocation;
}

const UNIT = /\.(ino|pde|c|cc|cpp|cxx)$/i;
const HEADER = /\.(h|hh|hpp|hxx)$/i;
const INCLUDE = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/;
/** `extern` declarations name a definition elsewhere in the sketch; the joined source has it. */
const EXTERN = /^\s*extern\s+(?!"C")[^{]*;\s*$/;

/**
 * Headers the simulator implements itself. A copy installed in `lib/` by the Library
 * Manager is for the real compile; pasting its source would replace the emulation.
 */
const SIMULATED_HEADERS = new Set(LIBRARY_CATALOG.flatMap((library) => library.includes));

/** The files the entry file's sketch is made of: its folder, `include/`, and `lib/`. */
export function sketchSourcePaths(paths: readonly string[]): string[] {
  const entry = pickEntryFile(paths);
  if (!entry) return [];
  const folder = directory(entry);
  return paths.filter((path) => {
    if (!UNIT.test(path) && !HEADER.test(path)) return false;
    return (
      path === entry ||
      path.startsWith('include/') ||
      path.startsWith('lib/') ||
      directory(path) === folder ||
      (folder === 'src' && path.startsWith('src/'))
    );
  });
}

export function combineSketch(files: readonly SketchFile[]): CombinedSketch | null {
  const entry = pickEntryFile(files.map((file) => file.path));
  if (!entry) return null;
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const lines: string[] = [];
  const origins: SketchLocation[] = [];
  const included = new Set<string>();
  /** `lib/<Name>` folders a sketch file included a header from. */
  const usedLibraries = new Set<string>();

  const emit = (path: string, stack: readonly string[]): void => {
    const content = byPath.get(path) ?? '';
    content.split(/\r?\n/).forEach((text, index) => {
      const line = index + 1;
      const include = INCLUDE.exec(text);
      const header = include ? resolveHeader(include[1], path, byPath) : null;
      if (header) {
        // Each header once, like `#pragma once`; a cycle is cut where it closes.
        const library = libraryOf(header);
        if (library) usedLibraries.add(library);
        if (!included.has(header) && !stack.includes(header)) {
          included.add(header);
          emit(header, [...stack, header]);
        }
        lines.push('');
        origins.push({ file: path, line });
        return;
      }
      lines.push(EXTERN.test(text) ? '' : text);
      origins.push({ file: path, line });
    });
  };

  const folder = directory(entry);
  const units = files.map((file) => file.path).filter((path) => path !== entry && UNIT.test(path));
  const tabs = units
    .filter((path) => /\.(ino|pde)$/i.test(path) && directory(path) === folder)
    .sort((a, b) => a.localeCompare(b));
  const others = units
    .filter((path) => !tabs.includes(path) && !libraryOf(path))
    .sort((a, b) => a.localeCompare(b));

  for (const path of [entry, ...tabs, ...others]) emit(path, [path]);

  // A project library's sources join only when the sketch includes it, as in Arduino
  // IDE and PlatformIO: an unused library must not break the simulation.
  // A library's own sources can include another library, so this runs until no new
  // library turns up.
  const emittedLibraries = new Set<string>();
  let library: string | undefined;
  while ((library = [...usedLibraries].sort().find((name) => !emittedLibraries.has(name)))) {
    emittedLibraries.add(library);
    units
      .filter((path) => libraryOf(path) === library)
      .sort((a, b) => a.localeCompare(b))
      .forEach((path) => emit(path, [path]));
  }

  return {
    entry,
    source: lines.join('\n'),
    locate: (line) => origins[line - 1] ?? { file: entry, line },
  };
}

/**
 * Where `#include "name"` points in this project, or null for a library the platform
 * provides. Arduino looks beside the including file first, then in the include paths;
 * `lib/<Name>/` and `lib/<Name>/src/` are where PlatformIO keeps project libraries.
 */
function resolveHeader(
  name: string,
  from: string,
  files: ReadonlyMap<string, string>,
): string | null {
  const candidates = [join(directory(from), name), `include/${name}`, `src/${name}`, name];
  for (const candidate of candidates) if (files.has(candidate)) return candidate;
  if (SIMULATED_HEADERS.has(name)) return null;
  for (const path of files.keys()) {
    if (!path.startsWith('lib/')) continue;
    if (
      path.endsWith(`/src/${name}`) ||
      (path.split('/').length === 3 && path.endsWith(`/${name}`))
    ) {
      return path;
    }
  }
  return null;
}

/** `lib/<Name>` for a file inside a project library, otherwise null. */
function libraryOf(path: string): string | null {
  const parts = path.split('/');
  return parts[0] === 'lib' && parts.length >= 3 ? `lib/${parts[1]}` : null;
}

function directory(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function join(folder: string, name: string): string {
  const parts = (folder ? `${folder}/${name}` : name).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

/** Reads the sketch's files with `read` and joins them; null when there is no sketch. */
export async function loadSketch(
  paths: readonly string[],
  read: (path: string) => Promise<string>,
): Promise<CombinedSketch | null> {
  const files = await Promise.all(
    sketchSourcePaths(paths).map(async (path) => ({ path, content: await read(path) })),
  );
  return combineSketch(files);
}
