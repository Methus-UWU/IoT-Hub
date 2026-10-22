import type { LibraryFile } from './library-archive';

/**
 * What a library says about itself, read from `library.json` (PlatformIO) or
 * `library.properties` (Arduino). Both are untrusted text; every field is optional.
 */
export interface LibraryDependency {
  /** Registry owner, when the manifest names one. */
  owner?: string;
  name: string;
}

/**
 * The marker the Library Manager writes into each folder it installs. It is the one
 * record of what is installed: removing the folder removes the library, and a
 * folder without it is the user's own code, which the manager never overwrites.
 */
export const LIBRARY_MARKER = 'library-source.json';

export interface LibraryMarker {
  owner: string;
  name: string;
  version: string;
  sha256: string;
  installedAt: string;
}

/** Libraries every supported Arduino core ships; the registry copies are unrelated. */
const FRAMEWORK_LIBRARIES = new Set(
  [
    'Arduino',
    'EEPROM',
    'Ethernet',
    'FS',
    'HTTPClient',
    'LittleFS',
    'Preferences',
    'SD',
    'SPI',
    'SPIFFS',
    'SoftwareSerial',
    'Update',
    'WebServer',
    'WiFi',
    'WiFiClientSecure',
    'Wire',
    'ESPmDNS',
    'BluetoothSerial',
    'BLE',
    'ESP32 BLE Arduino',
    'Ticker',
  ].map((name) => name.toLowerCase()),
);

export function isFrameworkLibrary(name: string): boolean {
  return FRAMEWORK_LIBRARIES.has(name.trim().toLowerCase());
}

/** Dependencies, preferring `library.json`, which can name the owner. */
export function libraryDependencies(files: LibraryFile[]): LibraryDependency[] {
  const json = files.find((file) => file.path === 'library.json');
  const fromJson = json ? jsonDependencies(json.content) : null;
  if (fromJson) return unique(fromJson);
  const properties = files.find((file) => file.path === 'library.properties');
  return properties ? unique(propertiesDependencies(properties.content)) : [];
}

/**
 * A folder name PlatformIO and the project path rules both accept: the registry
 * name with anything outside `[A-Za-z0-9._-]` turned into `_`.
 */
export function libraryFolderName(name: string): string {
  const folder = name
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 64)
    .replace(/[._-]+$/, '');
  return folder || 'library';
}

export function parseMarker(text: string): LibraryMarker | null {
  try {
    const value = JSON.parse(text) as Partial<LibraryMarker> | null;
    if (
      value &&
      typeof value.owner === 'string' &&
      typeof value.name === 'string' &&
      typeof value.version === 'string'
    ) {
      return {
        owner: value.owner,
        name: value.name,
        version: value.version,
        sha256: typeof value.sha256 === 'string' ? value.sha256 : '',
        installedAt:
          typeof value.installedAt === 'string' ? value.installedAt : '',
      };
    }
  } catch {
    // A hand-edited marker is treated as no marker.
  }
  return null;
}

function jsonDependencies(text: string): LibraryDependency[] | null {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== 'object') return null;
  const raw = (manifest as Record<string, unknown>)['dependencies'];
  if (raw === undefined) return null;

  // `{ "owner/name": "^1.0" }` or `[{ owner, name, frameworks }]`.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.keys(raw).flatMap((spec) => fromSpec(spec));
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown) => {
    if (typeof entry === 'string') return fromSpec(entry);
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    if (!forArduino(record['frameworks'])) return [];
    const name = typeof record['name'] === 'string' ? record['name'] : '';
    const owner =
      typeof record['owner'] === 'string' ? record['owner'] : undefined;
    return name ? fromSpec(owner ? `${owner}/${name}` : name) : [];
  });
}

/** `depends=Adafruit Unified Sensor, Foo (>=1.2)` */
function propertiesDependencies(text: string): LibraryDependency[] {
  const line = text
    .split(/\r?\n/)
    .find((entry) => /^\s*depends\s*=/.test(entry));
  if (!line) return [];
  return line
    .slice(line.indexOf('=') + 1)
    .split(',')
    .map((entry) => entry.replace(/\(.*\)/, '').trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

function fromSpec(spec: string): LibraryDependency[] {
  // `owner/name@^1.0`; a URL or a path is not a registry dependency.
  if (/[:\\]/.test(spec) || spec.startsWith('.')) return [];
  const withoutVersion = spec.replace(/@.*$/, '').trim();
  const slash = withoutVersion.indexOf('/');
  const name = (
    slash < 0 ? withoutVersion : withoutVersion.slice(slash + 1)
  ).trim();
  if (!name) return [];
  return slash < 0
    ? [{ name }]
    : [{ owner: withoutVersion.slice(0, slash).trim(), name }];
}

function forArduino(frameworks: unknown): boolean {
  if (frameworks === undefined || frameworks === '*') return true;
  const list = Array.isArray(frameworks) ? frameworks : [frameworks];
  return list.some((entry) => entry === '*' || entry === 'arduino');
}

function unique(dependencies: LibraryDependency[]): LibraryDependency[] {
  const seen = new Set<string>();
  return dependencies.filter((dependency) => {
    const key = dependency.name.toLowerCase();
    if (seen.has(key) || isFrameworkLibrary(dependency.name)) return false;
    seen.add(key);
    return true;
  });
}
