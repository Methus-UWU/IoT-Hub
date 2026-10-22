/**
 * Circuit simulator.
 *
 * Three passes per tick, in this order, because each depends on the previous:
 *
 *   1. **connect** — parts declare internal bonds (a closed switch contact).
 *      Only now can nets be built, because a switch physically merges two nets.
 *   2. **drive** — supply rails and part outputs push voltages onto nodes,
 *      which are then resolved by driver strength.
 *   3. **update** — parts read the resolved nodes and publish runtime values
 *      (LED brightness, relay coil state) for the artwork to draw.
 *
 * Nets are rebuilt every tick. That sounds wasteful but it is O(pins + wires)
 * with union-find, and it is what makes a switch closing actually re-wire the
 * circuit instead of merely copying a level across a gap.
 */

import type { VirtualDevice, WireConnection } from '../models/virtual-device.model';
import {
  FLOATING_NODE,
  type BusMessage,
  type DeviceBehavior,
  type DeviceSimulationContext,
  type DriveStrength,
  type NodeState,
} from '../devices/core/device-simulation';

export interface SimulatedDevice {
  readonly instanceId: string;
  readonly definition: VirtualDevice;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

export interface SimulationInput {
  readonly devices: readonly SimulatedDevice[];
  readonly connections: readonly WireConnection[];
  readonly deltaMs: number;
}

export interface SimulationResult {
  /** Runtime values per instance id, merged over properties when drawing. */
  readonly runtime: Readonly<Record<string, Record<string, string | number | boolean>>>;
  /** Resolved node state per pin key, for pin badges and warnings. */
  readonly pinStates: ReadonlyMap<string, NodeState>;
  /** Node keys where two strong drivers disagreed. */
  readonly shorts: readonly string[];
}

const EMPTY_RESULT: SimulationResult = {
  runtime: {},
  pinStates: new Map(),
  shorts: [],
};

/** Drive/resolve iterations per tick. See the relaxation loop for why. */
const RELAXATION_PASSES = 3;

export function devicePinKey(instanceId: string, pinName: string): string {
  return `device:${instanceId}:${pinName}`;
}

function junctionKey(junctionId: string): string {
  return `junction:${junctionId}`;
}

export function endpointKey(endpoint: WireConnection['start']): string {
  if (endpoint.type === 'junction') return junctionKey(endpoint.junctionId);
  return devicePinKey(endpoint.deviceId, endpoint.pinId);
}

/** Union-find over pin keys. Nets are just the resulting equivalence classes. */
export class NetBuilder {
  private readonly parent = new Map<string, string>();

  find(key: string): string {
    const seen = this.parent.get(key);
    if (seen === undefined) {
      this.parent.set(key, key);
      return key;
    }
    if (seen === key) return key;
    const root = this.find(seen);
    this.parent.set(key, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

interface Driver {
  readonly voltage: number;
  readonly strength: DriveStrength;
  /** PWM duty, 0–1, when this driver is pulsing rather than holding a level. */
  readonly duty?: number;
  /** The supply this level comes from, when the driver is a supply at all. */
  readonly source?: string;
  /**
   * Conductance of a weak driver, in siemens: 1 / its resistance. Weak drivers on a
   * node without a strong one share it in proportion, which is what makes a
   * two-resistor divider sit between its rails instead of at the higher one.
   */
  readonly weight?: number;
}

/** A weak driver that states no resistance counts as a 10 kΩ pull. */
const DEFAULT_WEAK_WEIGHT = 1 / 10_000;

/**
 * Which supply a power-source part counts as.
 *
 * Every schematic VCC and GND symbol shares one group, so they close a loop with
 * each other; a board or a battery is its own supply.
 */
function supplyIdOf(device: SimulatedDevice): string | undefined {
  if (!device.definition.powerSource) return undefined;
  return device.definition.supplyGroup ?? device.instanceId;
}

/**
 * Runs one simulation tick.
 *
 * Behaviours are supplied by the caller and persist across ticks, which is how
 * a part keeps internal state (a PIR's retrigger timer, a servo's slew).
 */
export function simulateTick(
  input: SimulationInput,
  behaviors: ReadonlyMap<string, DeviceBehavior>,
): SimulationResult {
  if (!input.devices.length) return EMPTY_RESULT;

  const nets = new NetBuilder();
  const runtime: Record<string, Record<string, string | number | boolean>> = {};
  const drivers = new Map<string, Driver[]>();
  const messages = new Map<string, BusMessage[]>();

  // Seed every pin as its own net so unconnected pins still resolve.
  for (const device of input.devices) {
    for (const devicePin of device.definition.pins) {
      nets.find(devicePinKey(device.instanceId, devicePin.name));
    }
  }

  // --- pass 1: wires and internal bonds -----------------------------------
  for (const wire of input.connections) {
    nets.union(endpointKey(wire.start), endpointKey(wire.end));
    // A wire's bend points can host junctions that other wires tap into.
    for (const waypoint of wire.waypoints) {
      if (waypoint.junctionId) {
        nets.union(endpointKey(wire.start), junctionKey(waypoint.junctionId));
      }
    }
  }

  for (const device of input.devices) {
    const behavior = behaviors.get(device.instanceId);
    if (!behavior?.connect) continue;
    behavior.connect(
      makeContext(device, input.deltaMs, nets, drivers, runtime, /* allowRead */ false),
    );
  }

  // --- pass 2: drive and resolve, relaxed to a fixed point ------------------
  //
  // A divider (a potentiometer's wiper, a sensor scaling its rail) has to read
  // its inputs before it can say what it outputs, so a single drive pass cannot
  // settle it. Re-running drive+resolve a few times lets those values propagate
  // one stage per iteration. Three passes covers the chains this catalog can
  // build; parts that drive a constant settle on the first and the extra
  // iterations cost nothing.
  let nodeStates = new Map<string, NodeState>();
  let shorts: string[] = [];

  for (let iteration = 0; iteration < RELAXATION_PASSES; iteration++) {
    drivers.clear();
    messages.clear();

    // Supply rails come from the parts that actually source power — a board, a
    // battery holder. A peripheral's VCC pin declares what it *expects*, so
    // driving from it would energise a circuit that reaches no supply at all.
    for (const device of input.devices) {
      const source = supplyIdOf(device);
      if (!source) continue;
      for (const devicePin of device.definition.pins) {
        const key = nets.find(devicePinKey(device.instanceId, devicePin.name));
        if (devicePin.type === 'gnd' || devicePin.kind === 'ground') {
          addDriver(drivers, key, 0, 'strong', undefined, source);
        } else if (devicePin.type === 'vcc' && devicePin.voltage !== undefined) {
          addDriver(drivers, key, devicePin.voltage, 'strong', undefined, source);
        }
        // Signal pins stay floating: without executing firmware there is
        // nothing to say what a GPIO is doing, and inventing a level is a lie.
      }
    }

    // Behaviours read the previous iteration's resolution, which is what makes
    // this a relaxation rather than a single-shot evaluation.
    const previous = nodeStates;
    for (const device of input.devices) {
      const behavior = behaviors.get(device.instanceId);
      if (!behavior?.drive) continue;
      behavior.drive(
        makeContext(device, input.deltaMs, nets, drivers, runtime, true, previous, messages),
      );
    }

    const resolved = new Map<string, NodeState>();
    shorts = [];
    for (const [root, nodeDrivers] of drivers) {
      const strong = nodeDrivers.filter((driver) => driver.strength === 'strong');
      const effective = strong.length ? strong : nodeDrivers;
      const highest = Math.max(...effective.map((driver) => driver.voltage));
      const lowest = Math.min(...effective.map((driver) => driver.voltage));
      // With no strong driver the weak ones divide the node between them.
      const weightOf = (driver: Driver) => driver.weight ?? DEFAULT_WEAK_WEIGHT;
      const level = strong.length
        ? highest
        : effective.reduce((sum, driver) => sum + driver.voltage * weightOf(driver), 0) /
          effective.reduce((sum, driver) => sum + weightOf(driver), 0);
      // Two strong drivers more than a diode drop apart is a short, not a
      // compromise — report it rather than averaging the difference away.
      const conflict = strong.length > 1 && highest - lowest > 0.7;
      if (conflict) shorts.push(root);
      // The node carries the pulse of whichever driver set its level, so an LED
      // on a PWM pin can tell a dimmed rail from a genuinely low voltage.
      const winner = strong.length
        ? effective.find((driver) => driver.voltage === highest)
        : effective.reduce((best, driver) => (weightOf(driver) > weightOf(best) ? driver : best));
      const duty =
        winner?.duty !== undefined && winner.duty > 0 && winner.duty < 1 ? winner.duty : undefined;
      // Every supply on the net, not just the winner: two grounds wired together
      // are a common ground, and either supply's loop can return through it.
      const sources = [
        ...new Set(effective.flatMap((driver) => (driver.source ? [driver.source] : []))),
      ];
      resolved.set(root, {
        voltage: level,
        floating: false,
        conflict,
        ...(duty !== undefined ? { duty } : {}),
        ...(sources.length ? { sources } : {}),
        ...(messages.has(root) ? { messages: messages.get(root) } : {}),
      });
    }
    // A node can carry data without anything holding its level, e.g. a data line
    // between two parts that only talk.
    for (const [root, published] of messages) {
      if (!resolved.has(root)) resolved.set(root, { ...FLOATING_NODE, messages: published });
    }
    nodeStates = resolved;
  }

  // --- pass 3: read back and publish runtime values ------------------------
  for (const device of input.devices) {
    const behavior = behaviors.get(device.instanceId);
    if (!behavior?.update) continue;
    behavior.update(makeContext(device, input.deltaMs, nets, drivers, runtime, true, nodeStates));
  }

  // --- expose per-pin state for badges and warnings ------------------------
  const pinStates = new Map<string, NodeState>();
  for (const device of input.devices) {
    for (const devicePin of device.definition.pins) {
      const key = devicePinKey(device.instanceId, devicePin.name);
      pinStates.set(key, nodeStates.get(nets.find(key)) ?? FLOATING_NODE);
    }
  }
  return { runtime, pinStates, shorts };
}

function addDriver(
  drivers: Map<string, Driver[]>,
  root: string,
  voltage: number,
  strength: DriveStrength,
  duty?: number,
  source?: string,
  weight?: number,
): void {
  const driver: Driver = {
    voltage,
    strength,
    ...(duty !== undefined ? { duty } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(weight !== undefined ? { weight } : {}),
  };
  const existing = drivers.get(root);
  if (existing) existing.push(driver);
  else drivers.set(root, [driver]);
}

function makeContext(
  device: SimulatedDevice,
  deltaMs: number,
  nets: NetBuilder,
  drivers: Map<string, Driver[]>,
  runtime: Record<string, Record<string, string | number | boolean>>,
  allowRead: boolean,
  nodeStates?: ReadonlyMap<string, NodeState>,
  messages?: Map<string, BusMessage[]>,
): DeviceSimulationContext {
  const keyFor = (pinName: string) => devicePinKey(device.instanceId, pinName);
  // A board's GPIO is fed from the board's own supply, so a module powered from
  // a pin still has to return to that board's ground.
  const source = supplyIdOf(device);

  return {
    deltaMs,
    properties: device.properties,
    readNode: (pinName) => {
      if (!allowRead || !nodeStates) return FLOATING_NODE;
      return nodeStates.get(nets.find(keyFor(pinName))) ?? FLOATING_NODE;
    },
    drive: (pinName, voltage, strength = 'strong', duty, weight) => {
      addDriver(drivers, nets.find(keyFor(pinName)), voltage, strength, duty, source, weight);
    },
    bond: (pinA, pinB) => nets.union(keyFor(pinA), keyFor(pinB)),
    publish: (pinName, protocol, data) => {
      // Outside the drive pass there is nowhere for a message to go.
      if (!messages) return;
      const root = nets.find(keyFor(pinName));
      const message: BusMessage = { protocol, from: device.instanceId, data };
      const existing = messages.get(root);
      if (existing) existing.push(message);
      else messages.set(root, [message]);
    },
    emit: (key, value) => {
      const bucket = runtime[device.instanceId] ?? (runtime[device.instanceId] = {});
      bucket[key] = value;
    },
  };
}
