import type { DeviceCategoryId, DeviceKind } from '../device-library.models';
import type {
  DeviceOperatingVoltage,
  DevicePropertyDefinition,
  DeviceReadingDefinition,
  DeviceRenderDefinition,
} from '../devices/core/device-definition';
import type { DeviceHotspot } from '../devices/core/device-hotspots';
import type { PhysicalSize } from '../devices/core/device-metrics';
import type { DeviceBehaviorFactory } from '../devices/core/device-simulation';
import type { DeviceInterface, PinDirection, PinType } from '../devices/core/device-types';

export type ConnectionKind = 'power' | 'ground' | 'signal';
export type PinSide = 'left' | 'right' | 'bottom' | 'top';
export type LcdInterface = 'parallel' | 'i2c';

export interface Point {
  x: number;
  y: number;
}

export interface DevicePin extends Point {
  name: string;
  kind: ConnectionKind;
  side?: PinSide;
  /**
   * Fine-grained classification layered on top of `kind`. Optional so parts
   * authored before the richer pin model keep type-checking; when present it
   * drives pin colour, tooltips, and wiring warnings.
   */
  type?: PinType;
  direction?: PinDirection;
  description?: string;
  aliases?: readonly string[];
  /** Nominal voltage this pin sources or expects, used by wiring checks. */
  voltage?: number;
  /** Highest signal voltage this input can safely receive. */
  maxInputVoltage?: number;
  /** Maximum current this supply pin can provide, in milliamps. */
  maxCurrentMa?: number;
  /** External bias required when the controller does not enable an internal pull resistor. */
  requiresBias?: 'up' | 'down';
  /** Defaults to true — most pins are shared electrical nodes. */
  multipleConnections?: boolean;
}

export interface LcdConfig {
  columns: 16 | 20;
  rows: 2 | 4;
  interface: LcdInterface;
  columnIndexes: readonly number[];
  rowIndexes: readonly number[];
}

/** Catalog metadata that only the Add Device modal needs. */
export interface DeviceCatalogInfo {
  categoryId: DeviceCategoryId;
  category: string;
  aliases: readonly string[];
  tags: readonly string[];
  interfaceLabel: string;
  typicalUsage: string;
}

export interface OnboardLed {
  /** Catalog pin name of the GPIO that drives it, e.g. `GPIO2` or `13`. */
  readonly pin: string;
  /** Lit when the pin is LOW, as on boards that sink the LED's current. */
  readonly activeLow?: boolean;
  /** As printed beside it on the board, e.g. `LED` or `L`. */
  readonly label: string;
}

export interface VirtualDevice {
  id: DeviceKind;
  name: string;
  model: string;
  description: string;
  /** Default drop position, used when the part is restored by "Reset diagram". */
  x: number;
  y: number;
  /**
   * Drawing units, the space the artwork and pins are authored in.
   *
   * `physicalSize` is what the part actually measures; `drawingScaleFor()`
   * relates the two, and applying that one factor to both the artwork and the
   * pins is what keeps every part on a single shared scale.
   */
  width: number;
  height: number;
  /**
   * Real-world dimensions of the part.
   *
   * The source of truth for how large it appears. Optional only so the catalog
   * can be migrated one part at a time; a part without it renders at its
   * drawing units, which is the old behaviour.
   */
  physicalSize?: PhysicalSize;
  pins: readonly DevicePin[];
  catalog: DeviceCatalogInfo;
  lcdConfig?: LcdConfig;
  relayChannels?: readonly number[];
  initiallyVisible?: boolean;

  /**
   * Declarative artwork. When present the shared shape renderer draws the part;
   * when absent `DeviceArt` falls back to its hand-authored template for the
   * original catalog parts. Both paths produce identical output everywhere the
   * part appears (canvas, ghost, thumbnail, inspector preview).
   */
  render?: DeviceRenderDefinition;
  /** Inspector knobs. Their defaults seed the device's runtime state. */
  properties?: readonly DevicePropertyDefinition[];
  /**
   * Live values this part publishes while the simulation runs, printed in the
   * inspector. Read-only: a reading is what the circuit did, not a knob.
   */
  readings?: readonly DeviceReadingDefinition[];
  /**
   * Regions of the artwork the user can operate directly — a button cap, a
   * relay channel. Declared here so the canvas never has to know which part it
   * is drawing in order to make it clickable.
   */
  hotspots?: readonly DeviceHotspot[];
  interfaces?: readonly DeviceInterface[];
  /** I2C address metadata used by wiring diagnostics and bus emulation. */
  i2cAddress?: {
    /** Inspector property that overrides the fixed/default address. */
    readonly property?: string;
    readonly fallback: string;
  };
  operatingVoltage?: DeviceOperatingVoltage;
  /** Voltage driven by this part's digital outputs. */
  logicVoltage?: number;
  /** Default absolute maximum for signal inputs on this part. */
  maxLogicInputVoltage?: number;
  /** Typical supply current used for rail-budget diagnostics. */
  supplyCurrentMa?: number;
  /**
   * Creates this part's simulation behaviour. A factory rather than a shared
   * object because each placed instance needs its own internal state.
   */
  simulation?: DeviceBehaviorFactory;
  /**
   * The user LED soldered to a board, and the GPIO that drives it. A sketch that
   * blinks "the LED" uses it with no extra part and no wire; it is what
   * `LED_BUILTIN` names on this board, and what the board's artwork lights.
   */
  onboardLed?: OnboardLed;
  /** Arduino core's default hardware SPI bus, expressed in catalog pin names. */
  defaultSpi?: {
    readonly mosi: string;
    readonly miso: string;
    readonly clock: string;
    readonly select?: string;
  };
  /** Blocks the rotate handle for parts that only make sense upright. */
  rotatable?: boolean;
  /**
   * This part *sources* power rather than consuming it: a development board, a
   * battery holder, a regulator module.
   *
   * The simulator drives supply rails only from parts marked here. Inferring it
   * from the pins cannot work, because a peripheral's `VCC` pin also declares
   * the voltage it expects — 5 V on an HC-SR04 means "feed me 5 V", not
   * "I produce 5 V", and treating the two alike energises a circuit nobody
   * wired to a supply.
   *
   * A supply's `gnd` pins become the ground reference for the same reason: a
   * peripheral's ground is only 0 V once it is wired back to something that
   * defines 0 V.
   */
  powerSource?: boolean;
  /**
   * Power sources that count as one supply. A part's VCC and GND have to reach
   * the same supply before it works, as current has to return to where it came
   * from. Unset, each placed source is its own supply; the schematic VCC and GND
   * symbols share a group so any of them close a loop with each other.
   */
  supplyGroup?: string;
  /**
   * Other catalog parts this one switches into from the inspector without being
   * re-placed — the two polarities of an RGB LED. Every variant lists the same
   * options. Wires carry across by pin name, or by pin position where the
   * variants name a pin differently.
   */
  variants?: {
    readonly label: string;
    readonly options: readonly { readonly deviceId: string; readonly label: string }[];
  };
  /**
   * The supply range of one placed instance, for a part whose rating is a
   * property — a motor bought as 3 V, 5 V or 12 V. The wiring check prefers it
   * over `operatingVoltage`.
   */
  operatingVoltageFor?: (
    properties: Readonly<Record<string, string | number | boolean>>,
  ) => NonNullable<VirtualDevice['operatingVoltage']>;
  /**
   * Parts that draw destructive current unless something limits it — LEDs,
   * mostly. Declared rather than inferred so the wiring check never has to
   * hard-code a list of device ids.
   */
  requiresSeriesResistor?: boolean;
  /**
   * Parts that limit current — a resistor, a pot. Their presence on an LED's
   * supply net is what satisfies `requiresSeriesResistor`. Marked here so the
   * check stays declarative even though such parts now pass voltage through.
   */
  limitsCurrent?: boolean;
  /**
   * Parts that already print their full pinout on their own silkscreen (an Uno,
   * the HC-SR04). Suppresses the canvas hover pin-name overlay, which would
   * otherwise duplicate — and collide with — the labels drawn on the artwork.
   * Declared per-device so the canvas never hard-codes a list of ids.
   */
  printsOwnPinLabels?: boolean;
  /**
   * Parts whose pin names carry no information worth printing on the canvas —
   * an unpolarised two-lead passive, where "1" and "2" are only an ordering.
   * The name still reaches the user through the pin's tooltip and the
   * inspector; this suppresses the drawn label alone.
   */
  hidesPinLabels?: boolean;
  /** Optional radius override for headers tighter than the non-overlapping 9.5-unit default. */
  pinHitRadius?: number;
}

export interface DevicePlacement extends Point {
  rotation: number;
  visible: boolean;
}

/** A catalog part placed on the canvas; `instanceId` is the server's component id. */
export interface DeviceInstance extends VirtualDevice {
  readonly instanceId: string;
}

/** A placed part's property values, keyed by property name. */
export type DeviceState = Readonly<Record<string, string | number | boolean>>;

/** A wire branch point on the canvas, shared by the wires that meet there. */
export interface WireJunction extends Point {
  readonly id: string;
  readonly kind: ConnectionKind;
}

/**
 * Either end of a wire.
 *
 * A development board is an ordinary placed device, so there is exactly one
 * kind of pin endpoint. The retired `board` variant existed for a single ESP32
 * drawn straight into the canvas template; every branch that special-cased it
 * was a place the board and the catalog could disagree.
 */
export type WireEndpoint =
  | { readonly type: 'device'; readonly deviceId: string; readonly pinId: string }
  | { readonly type: 'junction'; readonly junctionId: string };

export interface WireWaypoint extends Point {
  /** Present when this bend is an electrical junction shared by other wires. */
  readonly junctionId?: string;
}

export interface WireConnection {
  id: string;
  start: WireEndpoint;
  end: WireEndpoint;
  /** User-created bend anchors, ordered from start to end. */
  waypoints: readonly WireWaypoint[];
  color: string;
  kind: ConnectionKind;
}

export function pinKindFor(name: string): ConnectionKind {
  if (name === 'GND' || name === 'VSS' || name === 'K') return 'ground';
  if (name === 'VCC' || name === 'VDD' || name === 'A' || name === 'VIN') return 'power';
  return 'signal';
}
