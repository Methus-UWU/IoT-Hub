import {
  FirmwareRuntimeError,
  numeric,
  type FirmwareValue,
  type LibraryFactory,
  type LibraryHost,
  type LibraryObject,
} from '../firmware-values';

/** One emulated Arduino library: its classes, constants, and ready-made globals. */
export interface LibraryDefinition {
  readonly classes: Readonly<Record<string, LibraryFactory>>;
  readonly constants?: Readonly<Record<string, FirmwareValue>>;
  /** Objects the library itself declares, as `Wire` is declared by `Wire.h`. */
  readonly globals?: Readonly<Record<string, (host: LibraryHost) => LibraryObject>>;
}

type Method = (args: readonly FirmwareValue[], line: number) => FirmwareValue;

/**
 * Builds a library object from a method table. A method the table lacks is
 * reported with the library's name rather than silently returning 0 — a sketch
 * that relies on it would otherwise look like it works.
 */
export function libraryObject(
  className: string,
  methods: Readonly<Record<string, Method>>,
  extra: object = {},
): LibraryObject {
  return Object.assign(
    {
      className,
      call(method: string, args: readonly FirmwareValue[], line: number): FirmwareValue {
        const handler = Object.hasOwn(methods, method) ? methods[method] : undefined;
        if (!handler) {
          throw new FirmwareRuntimeError(`ตัวจำลองยังไม่รองรับ ${className}.${method}()`, line);
        }
        return handler(args, line);
      },
    },
    extra,
  );
}

/** A method that exists on the real library but changes nothing the canvas shows. */
export const accept: Method = () => 0;

/** Only named firmware fields are accessible; prototypes and host state stay private. */
export function libraryRecord(className: string, fields: Readonly<Record<string, FirmwareValue>>): LibraryObject {
  return libraryObject(className, {}, {
    read(field: string, line: number): FirmwareValue {
      if (!Object.hasOwn(fields, field)) throw new FirmwareRuntimeError(`ไม่รองรับ ${className}.${field}`, line);
      return fields[field];
    },
  });
}

/** Resolves a sketch pin number to the board's catalog pin, or reports it. */
export function requirePin(
  host: LibraryHost,
  value: FirmwareValue | undefined,
  className: string,
  line: number,
): string {
  const pin = numeric(value ?? -1, line);
  const name = host.pinName(pin);
  if (!name) {
    throw new FirmwareRuntimeError(`${className}: บอร์ดนี้ไม่มีขา ${pin}`, line);
  }
  return name;
}

/** First message of a protocol on a pin's node, or undefined when nothing answers. */
export function messageOn(host: LibraryHost, pinName: string | null, protocol: string) {
  if (!pinName) return undefined;
  return host.messages(pinName).find((message) => message.protocol === protocol);
}

export function hexAddress(value: number): string {
  return `0x${Math.trunc(value).toString(16).toUpperCase().padStart(2, '0')}`;
}
