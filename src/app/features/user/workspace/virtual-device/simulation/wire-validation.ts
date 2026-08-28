/**
 * Wiring checks.
 *
 * These are **advisory**. Real breadboard work involves deliberate oddities —
 * a pull-up to a different rail, a level shifter, a deliberately shared bus —
 * so a rule that blocked the user would be wrong more often than it was right.
 * Every finding is therefore reportable and dismissable, never enforced.
 *
 * Findings carry an explicit severity word and message rather than relying on
 * colour, so the list stays usable for anyone who cannot distinguish the hues.
 */

import type { DevicePin, VirtualDevice, WireConnection } from '../models/virtual-device.model';
import { NetBuilder, boardPinKey, devicePinKey, endpointKey } from './circuit-simulator';
import type { BoardPin } from '../models/virtual-device.model';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface WireIssue {
  /** Stable across re-validation so a dismissal sticks. */
  readonly id: string;
  readonly code: string;
  readonly severity: IssueSeverity;
  readonly title: string;
  readonly detail: string;
  readonly deviceIds: readonly string[];
  readonly wireIds: readonly string[];
}

export interface ValidationInput {
  readonly devices: readonly { instanceId: string; definition: VirtualDevice }[];
  readonly connections: readonly WireConnection[];
  readonly boardPins: readonly BoardPin[];
}

export const SEVERITY_LABELS: Readonly<Record<IssueSeverity, string>> = {
  error: 'ข้อผิดพลาด',
  warning: 'คำเตือน',
  info: 'ข้อสังเกต',
};

interface NetMember {
  readonly key: string;
  readonly deviceId?: string;
  readonly pin?: DevicePin;
  readonly device?: VirtualDevice;
  readonly boardPin?: BoardPin;
}

/** Supply voltage a board rail presents, mirroring the simulator's rails. */
const BOARD_RAIL_VOLTS: Readonly<Record<string, number>> = { '3v3': 3.3, vin: 5 };

export function validateCircuit(input: ValidationInput): readonly WireIssue[] {
  const nets = new NetBuilder();
  const members = new Map<string, NetMember>();

  for (const { instanceId, definition } of input.devices) {
    for (const pin of definition.pins) {
      const key = devicePinKey(instanceId, pin.name);
      nets.find(key);
      members.set(key, { key, deviceId: instanceId, pin, device: definition });
    }
  }
  for (const boardPin of input.boardPins) {
    const key = boardPinKey(boardPin.id);
    nets.find(key);
    members.set(key, { key, boardPin });
  }

  for (const wire of input.connections) {
    nets.union(endpointKey(wire.start), endpointKey(wire.end));
  }

  // Group members by resolved net.
  const byNet = new Map<string, NetMember[]>();
  for (const member of members.values()) {
    const root = nets.find(member.key);
    const bucket = byNet.get(root);
    if (bucket) bucket.push(member);
    else byNet.set(root, [member]);
  }

  // Wires touching each net, so a finding can point at something selectable.
  const wiresByNet = new Map<string, string[]>();
  for (const wire of input.connections) {
    const root = nets.find(endpointKey(wire.start));
    const bucket = wiresByNet.get(root);
    if (bucket) bucket.push(wire.id);
    else wiresByNet.set(root, [wire.id]);
  }

  const issues: WireIssue[] = [];

  for (const [root, netMembers] of byNet) {
    const wireIds = wiresByNet.get(root) ?? [];
    // A net of one pin is simply unconnected — not worth reporting.
    if (wireIds.length === 0) continue;

    issues.push(...checkDrivenTwice(root, netMembers, wireIds));
    issues.push(...checkPowerGroundShort(root, netMembers, wireIds));
    issues.push(...checkVoltageMismatch(root, netMembers, wireIds));
  }

  issues.push(...checkPinFanout(input, nets));
  issues.push(...checkMissingSeriesResistor(input, nets, byNet, wiresByNet));

  return issues;
}

/**
 * An LED sharing a supply net with nothing to limit the current.
 *
 * A resistor now passes voltage (so real circuits light), which means the old
 * open-circuit reachability trick no longer applies. Instead this looks at the
 * LED's net directly: if it reaches a supply but carries no current-limiting
 * part (`limitsCurrent`), the LED is unprotected. A resistor in series lands on
 * that same net and clears the finding.
 */
function checkMissingSeriesResistor(
  input: ValidationInput,
  nets: NetBuilder,
  byNet: ReadonlyMap<string, NetMember[]>,
  wiresByNet: ReadonlyMap<string, string[]>,
): readonly WireIssue[] {
  const issues: WireIssue[] = [];

  for (const { instanceId, definition } of input.devices) {
    if (!definition.requiresSeriesResistor) continue;

    for (const pin of definition.pins) {
      const key = devicePinKey(instanceId, pin.name);
      const root = nets.find(key);
      const members = byNet.get(root) ?? [];
      if (members.length < 2) continue;

      const supply = members.find(
        (member) => member.key !== key && railVoltsOf(member) > 0,
      );
      if (!supply) continue;

      // A limiter anywhere on this net — a series resistor — makes it safe.
      const limited = members.some(
        (member) => member.deviceId !== instanceId && member.device?.limitsCurrent,
      );
      if (limited) continue;

      issues.push({
        id: `${key}:no-series-resistor`,
        code: 'no-series-resistor',
        severity: 'warning',
        title: 'ไม่มีตัวต้านทานจำกัดกระแส',
        detail: `${definition.name}:${pin.name} ต่อเข้ากับ ${describe(supply)} โดยตรง ควรมีตัวต้านทานคั่น (ทั่วไปใช้ 220–330 Ω) มิฉะนั้นกระแสจะสูงเกินและทำให้ LED เสียหาย`,
        deviceIds: [instanceId],
        // Naming the wires lets the canvas highlight the offending run, not just
        // the part sitting at the end of it.
        wireIds: wiresByNet.get(root) ?? [],
      });
    }
  }

  return issues;
}

/** Volts this member sources, if it is a supply at all. */
function railVoltsOf(member: NetMember): number {
  if (member.boardPin) return BOARD_RAIL_VOLTS[member.boardPin.id] ?? 0;
  return pinTypeOf(member) === 'vcc' ? (member.pin?.voltage ?? 0) : 0;
}

/** Two outputs on one net fight each other the moment they disagree. */
function checkDrivenTwice(
  root: string,
  netMembers: readonly NetMember[],
  wireIds: readonly string[],
): readonly WireIssue[] {
  const drivers = netMembers.filter(
    (member) => member.pin?.direction === 'output' && member.pin.type !== 'nc',
  );
  if (drivers.length < 2) return [];

  const names = drivers.map((d) => `${d.device?.name ?? d.deviceId}:${d.pin?.name}`);
  return [
    {
      id: `${root}:output-conflict`,
      code: 'output-conflict',
      severity: 'error',
      title: 'ขาเอาต์พุตชนกัน',
      detail: `${names.join(' และ ')} เป็นเอาต์พุตทั้งคู่แต่ถูกต่ออยู่บนเส้นเดียวกัน เมื่อค่าต่างกันจะเกิดกระแสไหลย้อนและอาจทำให้ขาพัง`,
      deviceIds: unique(drivers.map((d) => d.deviceId).filter(isString)),
      wireIds,
    },
  ];
}

/** A supply pin wired straight to a ground pin is a dead short. */
function checkPowerGroundShort(
  root: string,
  netMembers: readonly NetMember[],
  wireIds: readonly string[],
): readonly WireIssue[] {
  const supplies = netMembers.filter((member) => pinTypeOf(member) === 'vcc');
  const grounds = netMembers.filter((member) => pinTypeOf(member) === 'gnd');
  if (!supplies.length || !grounds.length) return [];

  return [
    {
      id: `${root}:power-ground-short`,
      code: 'power-ground-short',
      severity: 'error',
      title: 'ไฟเลี้ยงลัดลงกราวด์',
      detail: `${describe(supplies[0])} ถูกต่อถึง ${describe(grounds[0])} โดยตรง วงจรนี้จะลัดวงจรทันทีที่จ่ายไฟ`,
      deviceIds: unique([...supplies, ...grounds].map((m) => m.deviceId).filter(isString)),
      wireIds,
    },
  ];
}

/** A 5 V rail reaching a part that tops out at 3.3 V. */
function checkVoltageMismatch(
  root: string,
  netMembers: readonly NetMember[],
  wireIds: readonly string[],
): readonly WireIssue[] {
  const railVolts = Math.max(
    0,
    ...netMembers.map((member) => {
      if (member.boardPin) return BOARD_RAIL_VOLTS[member.boardPin.id] ?? 0;
      return pinTypeOf(member) === 'vcc' ? (member.pin?.voltage ?? 0) : 0;
    }),
  );
  if (railVolts <= 0) return [];

  const issues: WireIssue[] = [];
  for (const member of netMembers) {
    const limit = member.device?.operatingVoltage?.max;
    // Only a supply pin carries the rail into the part; a signal pin sitting on
    // the same net is a different (and usually intentional) situation.
    if (limit === undefined || pinTypeOf(member) !== 'vcc') continue;
    if (railVolts <= limit + 0.05) continue;

    issues.push({
      id: `${root}:overvoltage:${member.key}`,
      code: 'overvoltage',
      severity: 'warning',
      title: 'แรงดันเกินพิกัด',
      detail: `${describe(member)} รองรับสูงสุด ${limit} V แต่ถูกต่อเข้ากับราง ${railVolts} V`,
      deviceIds: member.deviceId ? [member.deviceId] : [],
      wireIds,
    });
  }
  return issues;
}

/** Pins that the part says may host only one wire. */
function checkPinFanout(input: ValidationInput, _nets: NetBuilder): readonly WireIssue[] {
  const counts = new Map<string, number>();
  for (const wire of input.connections) {
    for (const endpoint of [wire.start, wire.end]) {
      const key = endpointKey(endpoint);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const issues: WireIssue[] = [];
  for (const { instanceId, definition } of input.devices) {
    for (const pin of definition.pins) {
      if (pin.multipleConnections !== false) continue;
      const key = devicePinKey(instanceId, pin.name);
      const count = counts.get(key) ?? 0;
      if (count <= 1) continue;

      issues.push({
        id: `${key}:fanout`,
        code: 'pin-fanout',
        severity: 'warning',
        title: 'ต่อสายเกินที่ขารองรับ',
        detail: `${definition.name}:${pin.name} รองรับได้ 1 เส้น แต่ตอนนี้มี ${count} เส้น`,
        deviceIds: [instanceId],
        wireIds: [],
      });
    }
  }
  return issues;
}

function pinTypeOf(member: NetMember): string | undefined {
  if (member.pin) return member.pin.type;
  if (!member.boardPin) return undefined;
  // Board pins predate the richer pin model, so map their coarse kind across.
  if (member.boardPin.kind === 'power') return 'vcc';
  if (member.boardPin.kind === 'ground') return 'gnd';
  return 'digital';
}

function describe(member: NetMember): string {
  if (member.boardPin) return `ESP32:${member.boardPin.label}`;
  return `${member.device?.name ?? member.deviceId}:${member.pin?.name}`;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}
