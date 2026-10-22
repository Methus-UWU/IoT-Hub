/**
 * The schema a catalog part is authored against.
 *
 * These types are additive: `VirtualDevice` in `models/virtual-device.model.ts`
 * gained them as *optional* fields, so parts written before this schema existed
 * keep working untouched while new parts opt into artwork, properties and
 * simulation. Nothing here is required to place a device on the canvas.
 */

import type { DetailLevel, Shape } from './device-shape';

/** Everything a part needs to draw itself for a given moment in time. */
export interface DeviceDrawContext {
  /** Live property + runtime values, keyed by property id. */
  readonly state: Readonly<Record<string, unknown>>;
  readonly detail: DetailLevel;
  /** True while the workspace simulation is running. */
  readonly running: boolean;
}

export interface DeviceRenderDefinition {
  /**
   * Pure function of state — no DOM, no side effects. Called on every state
   * change, so keep it cheap and allocation-light for large catalogs.
   */
  readonly draw: (context: DeviceDrawContext) => readonly Shape[];
  /**
   * Extra space around the body that the artwork bleeds into: component legs,
   * connector shells, sensor domes. Thumbnails use this to frame the part
   * without cropping. Defaults to zero on every edge.
   */
  readonly bleed?: {
    readonly left?: number;
    readonly right?: number;
    readonly top?: number;
    readonly bottom?: number;
  };
}

export type DevicePropertyKind = 'number' | 'select' | 'boolean' | 'text' | 'color';

export interface DevicePropertyOption {
  readonly value: string;
  readonly label: string;
}

/** One user-editable knob shown in the inspector. */
export interface DevicePropertyDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: DevicePropertyKind;
  readonly defaultValue: string | number | boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly options?: readonly DevicePropertyOption[];
  readonly description?: string;
  /** Inspector section: config knobs vs. live simulation controls. */
  readonly group?: 'general' | 'electrical' | 'simulation' | 'advanced';
  /** Simulation-only controls are disabled while the sim is stopped. */
  readonly simulationOnly?: boolean;
}

/**
 * One live value a running part publishes for the inspector to print.
 *
 * A part emits whatever it likes during a tick; declaring a reading is how it
 * says which of those values are meant for a person, and what to call them. The
 * inspector prints exactly the declared list, so a part gains a readout by
 * describing it here rather than by the panel learning the part's internals.
 */
export interface DeviceReadingDefinition {
  /** Key the behaviour passes to `emit`. */
  readonly id: string;
  readonly label: string;
  readonly unit?: string;
  readonly description?: string;
}

export interface DeviceOperatingVoltage {
  readonly min: number;
  readonly max: number;
  readonly recommended?: number;
}

/** Builds the starting state object from a part's property defaults. */
export function defaultStateFor(
  properties: readonly DevicePropertyDefinition[] | undefined,
): Record<string, string | number | boolean> {
  const state: Record<string, string | number | boolean> = {};
  for (const property of properties ?? []) state[property.id] = property.defaultValue;
  return state;
}

/** Reads a numeric property out of a draw context, falling back when unset. */
export function numberState(context: DeviceDrawContext, id: string, fallback: number): number {
  const value = context.state[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function booleanState(context: DeviceDrawContext, id: string, fallback = false): boolean {
  const value = context.state[id];
  return typeof value === 'boolean' ? value : fallback;
}

export function stringState(context: DeviceDrawContext, id: string, fallback: string): string {
  const value = context.state[id];
  return typeof value === 'string' ? value : fallback;
}
