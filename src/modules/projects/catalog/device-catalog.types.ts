/**
 * The electrical vocabulary the API validates wiring against.
 *
 * These names mirror the Angular catalog (`devices/core/device-types.ts`) exactly,
 * because `device-catalog.generated.ts` is produced from it. Renaming a member here
 * without renaming it there would silently reclassify every pin of that type.
 */

export type PinType =
  | 'vcc'
  | 'gnd'
  | 'digital'
  | 'analog'
  | 'pwm'
  | 'i2c-sda'
  | 'i2c-scl'
  | 'spi-mosi'
  | 'spi-miso'
  | 'spi-sck'
  | 'spi-cs'
  | 'uart-tx'
  | 'uart-rx'
  | 'reset'
  /** A bare two-terminal contact: resistor leads, switch poles, photocell legs. */
  | 'passive'
  | 'nc';

export type PinDirection =
  'input' | 'output' | 'bidirectional' | 'power' | 'passive';

export type ConnectionKind = 'power' | 'ground' | 'signal';

export type DeviceInterface =
  | 'digital'
  | 'analog'
  | 'pwm'
  | 'i2c'
  | 'spi'
  | 'uart'
  | 'onewire'
  | 'power'
  | 'passive';

export interface CatalogPin {
  readonly name: string;
  readonly type: PinType;
  readonly kind: ConnectionKind;
  readonly direction: PinDirection;
  /** Nominal volts this pin sources or expects. Absent on signal pins. */
  readonly voltage?: number;
  readonly maxInputVoltage?: number;
  readonly maxCurrentMa?: number;
  readonly requiresBias?: 'up' | 'down';
  /** Silkscreen names for the same hole, e.g. `D4` for `GPIO4`. */
  readonly aliases?: readonly string[];
  readonly description?: string;
  /** Present only when the pin hosts exactly one wire. */
  readonly multipleConnections?: false;
  /** Which header edge a board pin sits on. Present on boards only. */
  readonly side?: 'left' | 'right' | 'top' | 'bottom';
}

/**
 * A setting the user configures on a placed part, as the inspector offers it.
 * Stored in the component's `state`; the default applies when it is absent.
 */
export interface CatalogSetting {
  readonly id: string;
  readonly kind: string;
  readonly defaultValue: string | number | boolean;
  /** The only values a select accepts. */
  readonly options?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
}

export interface CatalogDevice {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly description: string;
  readonly categoryId: string;
  readonly category: string;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly typicalUsage: string;
  readonly interfaces: readonly DeviceInterface[];
  /** A development board: the part that hosts the firmware and drives the rails. */
  readonly isBoard: boolean;
  /** Sources power rather than consuming it — a board, a battery, a regulator. */
  readonly powerSource?: true;
  readonly requiresSeriesResistor?: true;
  readonly limitsCurrent?: true;
  readonly operatingVoltage?: {
    readonly min: number;
    readonly max: number;
    readonly recommended?: number;
  };
  readonly logicVoltage?: number;
  readonly maxLogicInputVoltage?: number;
  readonly supplyCurrentMa?: number;
  /**
   * The user LED soldered to a board and the pin that drives it. Blinking "the
   * LED" on this board needs no part and no wire.
   */
  readonly onboardLed?: {
    readonly pin: string;
    /** Lit when the pin is LOW. */
    readonly activeLow?: boolean;
    /** As printed beside it on the board. */
    readonly label: string;
  };
  readonly defaultSpi?: {
    readonly mosi: string;
    readonly miso: string;
    readonly clock: string;
    readonly select?: string;
  };
  readonly settings?: readonly CatalogSetting[];
  readonly pins: readonly CatalogPin[];
}

/**
 * Collapses a fine-grained pin type to the three-way kind the wiring engine uses.
 *
 * Kept as a function rather than read off the pin so a caller reasoning about a
 * requested type — one the LLM asked for, with no pin behind it yet — gets the same
 * answer the catalog would give.
 */
export function connectionKindForPinType(type: PinType): ConnectionKind {
  if (type === 'vcc') return 'power';
  if (type === 'gnd') return 'ground';
  return 'signal';
}

/**
 * True for pins carrying no expectation about what belongs on them.
 *
 * Both ends of a wire must normally share a `ConnectionKind`, which is right for a
 * VCC pin and wrong for a resistor lead: a resistor is equally at home in a power,
 * ground, or signal path. Without this a two-terminal part could not reach ground.
 */
export function isPassivePinType(type: PinType): boolean {
  return type === 'passive' || type === 'nc';
}

/** An Arduino library the simulator emulates, and the parts it drives. */
export interface LibraryReference {
  readonly name: string;
  /** PlatformIO `lib_deps` entry. Absent for libraries that ship with the core. */
  readonly platformio?: string;
  readonly includes: readonly string[];
  readonly devices: readonly string[];
  /** A minimal correct use: declaration, setup, and the calls that matter. */
  readonly usage: string;
  readonly limits?: string;
}
