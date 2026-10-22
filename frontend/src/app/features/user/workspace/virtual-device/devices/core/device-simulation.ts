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

/**
 * Data a part puts on a wire, for parts that talk rather than just hold a level.
 *
 * A DHT22 answers on its data line with a timed pulse train and an SSD1306 is
 * written over I2C. Neither can be modelled bit by bit on a 20 Hz tick, so the
 * exchange is carried whole: a sensor publishes its reading on its data pin, a
 * sketch's library call publishes what it wrote, and whoever shares the node
 * reads it. Only parts on the same node see a message, so the wiring still
 * decides who can talk to whom, and a part without power publishes nothing.
 */
export interface BusMessage {
  /** What kind of exchange this is, e.g. `dht`, `ssd1306`, `servo`. */
  readonly protocol: string;
  /** Instance id of the part that published it. */
  readonly from: string;
  readonly data: Readonly<Record<string, BusValue>>;
}

export type BusValue = string | number | boolean | readonly string[];

export interface NodeState {
  /** Resolved node voltage. */
  readonly voltage: number;
  /** True when nothing drives this node, so its level is undefined. */
  readonly floating: boolean;
  /** Two strong drivers disagreed — a short. Surfaced as a wiring warning. */
  readonly conflict: boolean;
  /**
   * Fraction of each PWM period the winning driver is high, between 0 and 1.
   * Absent for a steady level. `voltage` stays the average — what a meter, or an
   * ADC behind a filter, reads — so a part that responds to the pulse itself,
   * an LED, recovers the peak as `voltage / duty` and scales its output by duty.
   */
  readonly duty?: number;
  /**
   * The supplies whose rails reach this node: a board's or battery's instance
   * id, or a shared group such as the schematic symbols. Absent when only
   * non-supply parts drive it, which says nothing about where current returns.
   */
  readonly sources?: readonly string[];
  /** Data published on this node this tick. Absent when nobody published. */
  readonly messages?: readonly BusMessage[];
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

  /**
   * Drives a pin's node to a voltage for this tick. A PWM output passes its
   * average voltage and the `duty` it is high for; a steady level omits it.
   */
  drive(
    pinName: string,
    voltage: number,
    strength?: DriveStrength,
    duty?: number,
    /** For a weak drive, its conductance (1 / ohms); see the solver's weak sharing. */
    weight?: number,
  ): void;

  /**
   * Bonds two of the part's own pins together, as a closed switch contact does.
   * Bonds are collected before nodes are resolved, so a closed switch really
   * does merge the two nets rather than just copying a voltage across.
   */
  bond(pinA: string, pinB: string): void;

  /**
   * Puts data on the node a pin sits on, for the other parts on that node to read
   * through `readNode(...).messages`. Call it from `drive`, like a level.
   */
  publish(pinName: string, protocol: string, data: Readonly<Record<string, BusValue>>): void;

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

/**
 * Creates a behaviour for one placed device.
 *
 * The instance id is passed because a board has to find the sketch running on
 * *it* specifically — a diagram may hold two boards with different firmware.
 * Every other part ignores the argument.
 */
export type DeviceBehaviorFactory = (instanceId: string) => DeviceBehavior;

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

/**
 * True when two nodes can close a loop through one supply.
 *
 * Current leaves a supply's positive rail and has to return to that same
 * supply's ground. A module fed from a board's 3V3 but grounded on a separate
 * battery has no return path, so it stays dead even though the voltages alone
 * look right. Nodes that name no supply are not judged, so a divider or a
 * driver output still works the way it did.
 */
export function sameSupply(a: NodeState, b: NodeState): boolean {
  if (!a.sources?.length || !b.sources?.length) return true;
  return a.sources.some((source) => b.sources!.includes(source));
}

/**
 * Volts across a part's own supply pins; 0 when either is not wired to anything
 * or the two reach different supplies.
 */
export function supplyVolts(
  context: DeviceSimulationContext,
  supplyPin = 'VCC',
  groundPin = 'GND',
): number {
  const supply = context.readNode(supplyPin);
  const ground = context.readNode(groundPin);
  if (supply.floating || ground.floating || !sameSupply(supply, ground)) return 0;
  return supply.voltage - ground.voltage;
}

export interface SupplyRequirement {
  /** Lowest supply, across the part's own pins, at which it works. */
  readonly minimumVolts: number;
  readonly supplyPin?: string;
  readonly groundPin?: string;
}

/**
 * Makes a part's behaviour depend on its own power pins.
 *
 * A sensor module is not a signal generator: with VCC or GND unwired its outputs
 * float and its lamps stay dark, however its inspector is set. The wrapped
 * behaviour only drives and updates while the supply across its pins reaches
 * `minimumVolts`, and every tick publishes `powered`, so the artwork lights its
 * power lamp from the circuit rather than from the Start button.
 *
 * `drive` reads the previous relaxation pass, so outputs appear one pass after
 * the supply resolves — still inside the same tick. Losing power resets the
 * inner behaviour, as pulling a module's supply does.
 */
export function requiresSupply(
  factory: DeviceBehaviorFactory,
  requirement: SupplyRequirement,
): DeviceBehaviorFactory {
  const { minimumVolts, supplyPin = 'VCC', groundPin = 'GND' } = requirement;

  return (instanceId) => {
    const inner = factory(instanceId);
    const powered = (context: DeviceSimulationContext) =>
      supplyVolts(context, supplyPin, groundPin) >= minimumVolts;

    return {
      connect(context) {
        inner.connect?.(context);
      },
      drive(context) {
        // Drives levels and publishes data alike: a dead sensor says nothing.
        if (powered(context)) inner.drive?.(context);
      },
      update(context) {
        const on = powered(context);
        context.emit('powered', on);
        if (on) inner.update?.(context);
        else inner.reset?.();
      },
      reset() {
        inner.reset?.();
      },
    };
  };
}
