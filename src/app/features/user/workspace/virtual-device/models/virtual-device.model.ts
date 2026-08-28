import type { DeviceCategoryId, DeviceKind } from '../device-library.models';
import type {
  DeviceOperatingVoltage,
  DevicePropertyDefinition,
  DeviceRenderDefinition,
} from '../devices/core/device-definition';
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

export interface VirtualDevice {
  id: DeviceKind;
  name: string;
  model: string;
  description: string;
  /** Default drop position, used when the part is restored by "Reset diagram". */
  x: number;
  y: number;
  width: number;
  height: number;
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
  interfaces?: readonly DeviceInterface[];
  operatingVoltage?: DeviceOperatingVoltage;
  /**
   * Creates this part's simulation behaviour. A factory rather than a shared
   * object because each placed instance needs its own internal state.
   */
  simulation?: DeviceBehaviorFactory;
  /** Blocks the rotate handle for parts that only make sense upright. */
  rotatable?: boolean;
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
  /** Optional radius override for headers tighter than the non-overlapping 9.5-unit default. */
  pinHitRadius?: number;
}

export interface DevicePlacement extends Point {
  rotation: number;
  visible: boolean;
}

/** A header pin on the development board the peripherals wire back to. */
export interface BoardPin extends Point {
  id: string;
  label: string;
  detail: string;
  kind: ConnectionKind;
  side: 'left' | 'right';
}

/** Either end of a wire can belong to the ESP32 or to any placed device. */
export type WireEndpoint =
  | { readonly type: 'board'; readonly pinId: string }
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
