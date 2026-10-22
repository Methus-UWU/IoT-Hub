import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

/**
 * Reads a library archive from the PlatformIO registry into project files.
 *
 * The archive is untrusted input from a third party: any tar header may lie about
 * its size, a path may climb out with `..`, an entry may be a symlink, and a small
 * download may inflate into gigabytes. Nothing here touches a filesystem — entries
 * become strings that go through the same path and size rules as any project file —
 * and every limit is checked before the bytes are kept.
 */

/** Compressed download limit. The largest common Arduino libraries are well below. */
export const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
/** Inflated tar limit; `gunzip` stops at this instead of filling memory. */
export const MAX_UNPACKED_BYTES = 24 * 1024 * 1024;
/** What one library may add to a project, after examples and docs are dropped. */
export const MAX_LIBRARY_FILES = 300;
export const MAX_LIBRARY_BYTES = 4 * 1024 * 1024;
/** Same as a project file (`project-file-path.ts`). */
const MAX_FILE_BYTES = 512 * 1024;
/** `lib/<Folder>/` takes two of a project path's twelve segments. */
const MAX_DEPTH = 10;

const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SOURCE = /\.(h|hh|hpp|hxx|inc|ipp|tpp|c|cc|cpp|cxx|s)$/i;
const LICENSE = /^(licen[cs]e|copying)(\.(txt|md))?$/i;
const MANIFESTS = new Set(['library.properties', 'library.json']);
/** Top-level folders a build never compiles. */
const SKIPPED_FOLDERS = new Set([
  'examples',
  'example',
  'test',
  'tests',
  'extras',
  'docs',
  'doc',
  'documentation',
]);

export class LibraryArchiveError extends Error {}

export interface TarEntry {
  path: string;
  data: Buffer;
}

export interface LibraryFile {
  /** Relative to the library root, e.g. `src/DHT.h`. */
  path: string;
  content: string;
}

export interface ExtractedLibrary {
  files: LibraryFile[];
  /** Entries left out: examples, docs, binaries, and anything not source. */
  skipped: number;
}

const inflate = promisify(gunzip);

export async function extractLibrary(
  archive: Buffer,
): Promise<ExtractedLibrary> {
  if (archive.length > MAX_ARCHIVE_BYTES) {
    throw new LibraryArchiveError('The library download is too large.');
  }
  let tar: Buffer;
  try {
    tar = await inflate(archive, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch {
    throw new LibraryArchiveError(
      'The library archive is damaged or unpacks too large.',
    );
  }
  return selectLibraryFiles(readTar(tar));
}

/**
 * A minimal ustar/pax/GNU reader: regular files only. Directories, links, and
 * devices are skipped, so nothing an archive declares can point outside it.
 */
export function readTar(tar: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    if (!checksumMatches(header)) {
      throw new LibraryArchiveError('The library archive is damaged.');
    }
    const size = octal(header.subarray(124, 136));
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    const start = offset + 512;
    const end = start + size;
    if (end > tar.length) {
      throw new LibraryArchiveError('The library archive is truncated.');
    }
    const data = tar.subarray(start, end);
    offset = start + Math.ceil(size / 512) * 512;

    if (type === 'L') {
      longName = cString(data);
      continue;
    }
    if (type === 'x') {
      paxPath = paxRecords(data).get('path') ?? null;
      continue;
    }
    if (type === 'g') continue;

    const name = cString(header.subarray(0, 100));
    const ustar = header.subarray(257, 262).toString('latin1') === 'ustar';
    const prefix = ustar ? cString(header.subarray(345, 500)) : '';
    const path = paxPath ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    paxPath = null;
    if (type === '0' || type === '7') entries.push({ path, data });
  }
  return entries;
}

/**
 * The files a build needs: sources and headers, the manifest, and the license.
 * Examples, tests, and docs stay behind; binaries are refused rather than stored.
 */
export function selectLibraryFiles(entries: TarEntry[]): ExtractedLibrary {
  let normalized = entries.map((entry) => ({
    parts: entry.path.split('/').filter((part) => part && part !== '.'),
    data: entry.data,
  }));

  // The registry packs a library at the archive root; a GitHub-style archive wraps
  // it in one folder. Unwrap that folder when the root has no manifest.
  const roots = new Set(normalized.map((entry) => entry.parts[0]));
  const rootManifest = normalized.some(
    (entry) => entry.parts.length === 1 && MANIFESTS.has(entry.parts[0]),
  );
  if (
    roots.size === 1 &&
    !rootManifest &&
    normalized.every((e) => e.parts.length > 1)
  ) {
    normalized = normalized.map((entry) => ({
      ...entry,
      parts: entry.parts.slice(1),
    }));
  }

  const files: LibraryFile[] = [];
  let skipped = 0;
  let totalBytes = 0;

  for (const { parts, data } of normalized) {
    const name = parts.at(-1) ?? '';
    const atRoot = parts.length === 1;
    const wanted =
      parts.length > 0 &&
      !parts.some((part) => part.startsWith('.')) &&
      !SKIPPED_FOLDERS.has(parts[0].toLowerCase()) &&
      (SOURCE.test(name) ||
        (atRoot && (MANIFESTS.has(name) || LICENSE.test(name))));
    if (!wanted) {
      skipped++;
      continue;
    }
    if (parts.some((part) => part === '..')) {
      throw new LibraryArchiveError(
        'The library archive contains an unsafe path.',
      );
    }
    if (
      parts.length > MAX_DEPTH ||
      parts.some((part) => !SAFE_SEGMENT.test(part))
    ) {
      throw new LibraryArchiveError(
        `The library has a file this platform cannot store: ${parts.join('/')}`,
      );
    }
    if (data.includes(0)) {
      // Source extensions on a binary: not something to keep as text.
      skipped++;
      continue;
    }
    if (data.length > MAX_FILE_BYTES) {
      throw new LibraryArchiveError(
        `${parts.join('/')} is larger than a project file may be.`,
      );
    }

    const path = parts.join('/');
    const text = decodeText(data);
    const content = path === 'library.json' ? sanitizeLibraryJson(text) : text;
    if (content === null) {
      skipped++;
      continue;
    }
    totalBytes += Buffer.byteLength(content, 'utf8');
    files.push({ path, content });
    if (files.length > MAX_LIBRARY_FILES || totalBytes > MAX_LIBRARY_BYTES) {
      throw new LibraryArchiveError(
        'The library is too large to add to a project.',
      );
    }
  }

  if (!files.some((file) => /\.(h|hh|hpp|hxx)$/i.test(file.path))) {
    throw new LibraryArchiveError('The library has no header to include.');
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}

/**
 * PlatformIO runs a library's `build.extraScript` as Python during the build. The
 * builder is isolated either way (ADR-002); dropping the script here means a
 * registry library never brings one in. Package-manager `scripts` go too.
 * Returns null when the manifest is not JSON, which PlatformIO would reject anyway.
 */
export function sanitizeLibraryJson(text: string): string | null {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return null;
  }
  const record = manifest as Record<string, unknown>;
  delete record['scripts'];
  const build = record['build'];
  if (build && typeof build === 'object' && !Array.isArray(build)) {
    delete (build as Record<string, unknown>)['extraScript'];
    delete (build as Record<string, unknown>)['extraScripts'];
  }
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** UTF-8 when the bytes are UTF-8; older libraries are often Latin-1. */
function decodeText(data: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return data.toString('latin1');
  }
}

function checksumMatches(header: Buffer): boolean {
  let sum = 0;
  for (let index = 0; index < 512; index++) {
    sum += index >= 148 && index < 156 ? 32 : header[index];
  }
  return sum === octal(header.subarray(148, 156));
}

function octal(field: Buffer): number {
  // Base-256 sizes (high bit set) only appear above 8 GB; nothing that large is valid.
  if (field[0] & 0x80) {
    throw new LibraryArchiveError('The library archive is too large.');
  }
  const text = cString(field).trim();
  if (!/^[0-7]*$/.test(text)) {
    throw new LibraryArchiveError('The library archive is damaged.');
  }
  return text ? parseInt(text, 8) : 0;
}

function cString(field: Buffer): string {
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString('utf8');
}

function paxRecords(data: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) break;
    const length = parseInt(
      data.subarray(offset, space).toString('latin1'),
      10,
    );
    if (!Number.isFinite(length) || length <= 0) break;
    const record = data
      .subarray(space + 1, offset + length - 1)
      .toString('utf8');
    const equals = record.indexOf('=');
    if (equals > 0)
      records.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return records;
}
