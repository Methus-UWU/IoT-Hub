/**
 * Simulation contract for catalog parts.
 *
 * The model is deliberately a *node voltage* model rather than a full SPICE
 * solve: every pin sits on an electrical node, parts drive nodes with a
 * strength, and the strongest driver wins. That is enough to make the circuits
 * this workspace is for behave correctly — a button pulling a GPIO to ground, an
 * LED lighting from a rail, a relay coil energising — without the cost and the
 * convergence failures of a real analog solver.
 *
 * Parts opt in by exporting a `createBehavior` factory. One behaviour instance
 * is created per placed device, so two buttons never share debounce state.
 */

/**
 * How hard a pin drives its node.
 *
 * `strong` is a push-pull output or a supply rail; `weak` is a pull-up or
 * pull-down that any strong driver overrides. A pin that drives nothing at all
 * simply never calls `drive`, which leaves the node floating.
 */
export type DriveStrength = 'strong' | 'weak';

export interface NodeState {
  /** Resolved node voltage. */
  readonly voltage: number;
  /** True when nothing drives this node, so its level is undefined. */
  readonly floating: boolean;
  /** Two strong drivers disagreed — a short. Surfaced as a wiring warning. */
  readonly conflict: boolean;
}

export const FLOATING_NODE: NodeState = Object.freeze({
  voltage: 0,
  floating: true,
  conflict: false,
});

/**
 * Logic threshold. Real parts have per-family thresholds, but a single 50 %
 * split of the local rail is accurate enough here and keeps 3.3 V and 5 V
 * circuits behaving the same way.
 */
export function isLogicHigh(node: NodeState, rail = 3.3): boolean {
  return !node.floating && node.voltage >= rail * 0.5;
}

/** What a behaviour can see and do during one tick. */
export interface DeviceSimulationContext {
  /** Milliseconds since the previous tick. */
  readonly deltaMs: number;
  /** Property values from the inspector, keyed by property id. */
  readonly properties: Readonly<Record<string, string | number | boolean>>;

  /** Resolved state of the node a pin sits on. */
  readNode(pinName: string): NodeState;

  /** Drives a pin's node to a voltage for this tick. */
  drive(pinName: string, voltage: number, strength?: DriveStrength): void;

  /**
   * Bonds two of the part's own pins together, as a closed switch contact does.
   * Bonds are collected before nodes are resolved, so a closed switch really
   * does merge the two nets rather than just copying a voltage across.
   */
  bond(pinA: string, pinB: string): void;

  /**
   * Publishes a value for the artwork and the inspector to read. Runtime values
   * are merged over the property values when a part draws itself.
   */
  emit(key: string, value: string | number | boolean): void;
}

export interface DeviceBehavior {
  /**
   * Declares switch contacts and other internal bonds. Runs before node
   * resolution, so this is the only place `bond` has an effect.
   */
  connect?(context: DeviceSimulationContext): void;

  /**
   * Drives outputs. Runs after bonds are known but before nodes are read back,
   * so a part must not depend on `readNode` here.
   */
  drive?(context: DeviceSimulationContext): void;

  /** Reads resolved nodes and publishes runtime values. */
  update?(context: DeviceSimulationContext): void;

  /** Clears internal state when the simulation stops or the part is reset. */
  reset?(): void;
}

export type DeviceBehaviorFactory = () => DeviceBehavior;

/** Reads a numeric property inside a behaviour. */
export function propertyNumber(
  context: DeviceSimulationContext,
  id: string,
  fallback: number,
): number {
  const value = context.properties[id];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function propertyBoolean(
  context: DeviceSimulationContext,
  id: string,
  fallback = false,
): boolean {
  const value = context.properties[id];
  return typeof value === 'boolean' ? value : fallback;
}

export function propertyString(
  context: DeviceSimulationContext,
  id: string,
  fallback: string,
): string {
  const value = context.properties[id];
  return typeof value === 'string' ? value : fallback;
}
