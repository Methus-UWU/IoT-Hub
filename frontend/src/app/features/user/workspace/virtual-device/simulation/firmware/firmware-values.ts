import type { BusMessage, BusValue } from '../../devices/core/device-simulation';

/**
 * Values the sketch VM works with, and the contract library emulations implement.
 *
 * Kept apart from the interpreter so a library can use them without importing the
 * interpreter that imports the libraries.
 */

export type FirmwareValue = number | string | boolean | FirmwareArray | LibraryObject | FirmwareFunction | FirmwareRecord;

/** Arrays are mutable by design — `values[i] = x` has to be observable. */
export type FirmwareArray = FirmwareValue[];

export class FirmwareRuntimeError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'FirmwareRuntimeError';
  }
}

/**
 * An instance of a library class, e.g. `DHT dht(4, DHT22)`.
 *
 * Emulated at the level a sketch can observe: what `readTemperature()` returns,
 * what `display()` puts on the glass. Protocol timing is not modelled.
 */
export interface LibraryObject {
  readonly className: string;
  call(method: string, args: readonly FirmwareValue[], line: number): FirmwareValue;
  read?(field: string, line: number): FirmwareValue;
}

/** A user function passed as a callback, for example to attachInterrupt(). */
export interface FirmwareFunction {
  readonly className: 'Function';
  readonly functionName: string;
  call(method: string, args: readonly FirmwareValue[], line: number): FirmwareValue;
}

/** One instance of a user-declared struct or class. */
export interface FirmwareRecord {
  readonly className: string;
  readonly fields: Map<string, FirmwareValue>;
}

export function isFirmwareRecord(value: FirmwareValue | undefined): value is FirmwareRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'fields' in value && value.fields instanceof Map;
}

export function isFirmwareFunction(value: FirmwareValue | undefined): value is FirmwareFunction {
  return isLibraryObject(value) && value.className === 'Function' && 'functionName' in value;
}

/** What a library emulation may reach in the circuit. */
export interface LibraryHost {
  /** The board's catalog pin for a sketch pin number, or null if it has none. */
  pinName(pin: number): string | null;
  /** Data other parts published on the node of a catalog pin, as of the last tick. */
  messages(pinName: string): readonly BusMessage[];
  /**
   * What this sketch keeps publishing on a pin under `key` until it is replaced,
   * as a display keeps showing its last frame.
   */
  publish(
    pinName: string,
    key: string,
    protocol: string,
    data: Readonly<Record<string, BusValue>>,
  ): void;
  /** The board's I2C pins: its defaults until `Wire.begin(sda, scl)` moves them. */
  i2cPins(): { readonly sda: string | null; readonly scl: string | null };
  setI2cPins(sda: string | null, scl: string | null): void;
  spiPins(): { readonly mosi: string | null; readonly miso: string | null; readonly clock: string | null };
  setSpiPins(clock: string | null, miso: string | null, mosi: string | null): void;
  now(): number;
}

export type LibraryFactory = (
  args: readonly FirmwareValue[],
  host: LibraryHost,
  line: number,
) => LibraryObject;

export function isLibraryObject(value: FirmwareValue | undefined): value is LibraryObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'call' in value && typeof value.call === 'function';
}

export function truthy(value: FirmwareValue | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined;
}

export function numeric(value: FirmwareValue | undefined, line: number): number {
  if (value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (Array.isArray(value)) {
    throw new FirmwareRuntimeError('ใช้อาร์เรย์ในนิพจน์ตัวเลขไม่ได้', line);
  }
  throw new FirmwareRuntimeError(`ใช้อ็อบเจกต์ ${value.className} ในนิพจน์ตัวเลขไม่ได้`, line);
}

export function stringify(value: FirmwareValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return formatNumber(value);
  if (Array.isArray(value)) return value.map(stringify).join(',');
  if (typeof value === 'object') return value.className;
  return value;
}

/** How Arduino's `print` writes a number: `nan`, `inf`, integers bare. */
function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  return String(value);
}

/**
 * `print(value)` and `print(value, format)`, shared by Serial and every display.
 * A second number is a base for an integer (DEC, HEX, BIN) or decimal places.
 */
export function formatPrint(
  value: FirmwareValue | undefined,
  format: FirmwareValue | undefined,
): string {
  if (typeof value === 'number' && (Number.isNaN(value) || !Number.isFinite(value))) {
    return formatNumber(value);
  }
  if (typeof value === 'number' && typeof format === 'number') {
    if (format === 10 || format === 16 || format === 2 || format === 8) {
      return Math.trunc(value).toString(format).toUpperCase();
    }
    return value.toFixed(Math.max(0, Math.min(20, format)));
  }
  if (typeof value === 'number' && !Number.isInteger(value)) return value.toFixed(2);
  return stringify(value);
}

/** C `printf`: `%d %i %u %ld %f %.2f %s %c %x %X %%`, with width and zero padding. */
export function formatPrintf(template: string, args: readonly FirmwareValue[]): string {
  let next = 0;
  return template.replace(
    /%([-0]?)(\d+)?(?:\.(\d+))?(l{0,2}|h{0,2}|z)?([diufFeEgGsScxXo%])/g,
    (
      _match,
      flag: string,
      width: string | undefined,
      precision: string | undefined,
      _size,
      type: string,
    ) => {
      if (type === '%') return '%';
      const value = args[next++];
      let text: string;
      switch (type) {
        case 'd':
        case 'i':
        case 'u':
          text = String(
            Math.trunc(typeof value === 'number' ? value : Number(stringify(value)) || 0),
          );
          break;
        case 'x':
        case 'X':
        case 'o': {
          const number = Math.trunc(typeof value === 'number' ? value : 0) >>> 0;
          text = number.toString(type === 'o' ? 8 : 16);
          if (type === 'X') text = text.toUpperCase();
          break;
        }
        case 'c':
          text =
            typeof value === 'number' ? String.fromCharCode(value) : stringify(value).charAt(0);
          break;
        case 's':
        case 'S':
          text = stringify(value);
          break;
        default: {
          const number = typeof value === 'number' ? value : Number(stringify(value));
          text = Number.isFinite(number)
            ? number.toFixed(precision !== undefined ? Number(precision) : 6)
            : formatNumber(number);
        }
      }
      const size = width ? Number(width) : 0;
      if (text.length >= size) return text;
      if (flag === '-') return text.padEnd(size);
      return text.padStart(size, flag === '0' ? '0' : ' ');
    },
  );
}
