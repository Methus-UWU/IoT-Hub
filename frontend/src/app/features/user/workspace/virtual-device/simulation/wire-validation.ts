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
import { NetBuilder, devicePinKey, endpointKey } from './circuit-simulator';

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
  readonly devices: readonly {
    instanceId: string;
    definition: VirtualDevice;
    /** Property values, for parts whose rating depends on them. */
    properties?: Readonly<Record<string, string | number | boolean>>;
  }[];
  readonly connections: readonly WireConnection[];
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
  readonly properties?: Readonly<Record<string, string | number | boolean>>;
}

export function validateCircuit(input: ValidationInput): readonly WireIssue[] {
  const nets = new NetBuilder();
  const members = new Map<string, NetMember>();

  for (const { instanceId, definition, properties } of input.devices) {
    for (const pin of definition.pins) {
      const key = devicePinKey(instanceId, pin.name);
      nets.find(key);
      members.set(key, { key, deviceId: instanceId, pin, device: definition, properties });
    }
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
    issues.push(...checkLogicLevelMismatch(root, netMembers, wireIds));
    issues.push(...checkUartPolarity(root, netMembers, wireIds));
  }

  issues.push(...checkPinFanout(input, nets));
  issues.push(...checkMissingSeriesResistor(input, nets, byNet, wiresByNet));
  issues.push(...checkSplitSupply(input, nets, byNet));
  issues.push(...checkMissingRequiredPower(input));
  issues.push(...checkIncompleteI2cBus(input));
  issues.push(...checkI2cAddressConflicts(input, nets));
  issues.push(...checkDuplicateSpiChipSelect(input, nets));
  issues.push(...checkSupplyCurrent(input, nets, byNet, wiresByNet));
  issues.push(...checkMissingBiasResistors(input, nets, byNet));

  return issues;
}

/** UART is point-to-point: TX must reach RX, never another TX or only another RX. */
function checkUartPolarity(
  root: string,
  netMembers: readonly NetMember[],
  wireIds: readonly string[],
): readonly WireIssue[] {
  const tx = netMembers.filter((member) => member.pin?.type === 'uart-tx');
  const rx = netMembers.filter((member) => member.pin?.type === 'uart-rx');
  if (tx.length < 2 && rx.length < 2) return [];
  const wrong = tx.length >= 2 ? tx : rx;
  const label = tx.length >= 2 ? 'TX' : 'RX';
  return [{
    id: `${root}:uart-polarity`,
    code: 'uart-polarity',
    severity: 'error',
    title: 'ต่อ UART ผิดขา',
    detail: `${wrong.map(describe).join(' และ ')} เป็นขา ${label} เหมือนกัน UART ต้องต่อ TX ไป RX และ RX ไป TX`,
    deviceIds: unique(wrong.map((member) => member.deviceId).filter(isString)),
    wireIds,
  }];
}

/** A controller must give each SPI peripheral its own chip-select net. */
function checkDuplicateSpiChipSelect(
  input: ValidationInput,
  nets: NetBuilder,
): readonly WireIssue[] {
  const groups = new Map<string, NetMember[]>();
  for (const { instanceId, definition, properties } of input.devices) {
    if (definition.powerSource) continue;
    for (const pin of definition.pins.filter((candidate) => candidate.type === 'spi-cs')) {
      const root = nets.find(devicePinKey(instanceId, pin.name));
      const bucket = groups.get(root) ?? [];
      bucket.push({ key: devicePinKey(instanceId, pin.name), deviceId: instanceId, pin, device: definition, properties });
      groups.set(root, bucket);
    }
  }
  return [...groups.entries()].flatMap(([root, devices]) => {
    const connectedIds = unique(devices.map((device) => device.deviceId).filter(isString));
    if (connectedIds.length < 2) return [];
    return [{
      id: `${root}:spi-cs-conflict`,
      code: 'spi-cs-conflict',
      severity: 'error' as const,
      title: 'ขาเลือกอุปกรณ์ SPI ซ้ำกัน',
      detail: `${devices.map(describe).join(' และ ')} ใช้สาย CS เดียวกัน อุปกรณ์ SPI แต่ละตัวต้องมีขา CS แยกกัน`,
      deviceIds: connectedIds,
      wireIds: unique(connectedIds.flatMap((id) => wiresForDevice(input, id))),
    }];
  });
}

/** A high signal must stay below the receiving pin's absolute input limit. */
function checkLogicLevelMismatch(
  root: string,
  netMembers: readonly NetMember[],
  wireIds: readonly string[],
): readonly WireIssue[] {
  const sources = netMembers.filter((member) =>
    member.pin?.direction === 'output' && member.pin.type !== 'vcc' && member.pin.type !== 'gnd',
  );
  if (!sources.length) return [];
  const highest = Math.max(...sources.map((member) => member.pin?.voltage ?? member.device?.logicVoltage ?? 0));
  if (highest <= 0) return [];
  return netMembers.flatMap((member) => {
    if (member.pin?.direction === 'output') return [];
    const limit = member.pin?.maxInputVoltage ?? member.device?.maxLogicInputVoltage;
    if (limit === undefined || highest <= limit + 0.05) return [];
    return [{
      id: `${root}:logic-overvoltage:${member.key}`,
      code: 'logic-overvoltage',
      severity: 'warning' as const,
      title: 'ระดับสัญญาณสูงเกินพิกัดอินพุต',
      detail: `${describe(member)} รับได้ไม่เกิน ${limit} V แต่มีเอาต์พุต ${highest} V บนสายเดียวกัน ควรใช้ตัวแบ่งแรงดันหรือตัวแปลงระดับลอจิก`,
      deviceIds: unique([...sources.map((source) => source.deviceId), member.deviceId].filter(isString)),
      wireIds,
    }];
  });
}

/** Sum typical loads on each powered rail and compare them with its declared limit. */
function checkSupplyCurrent(
  input: ValidationInput,
  nets: NetBuilder,
  byNet: ReadonlyMap<string, NetMember[]>,
  wiresByNet: ReadonlyMap<string, string[]>,
): readonly WireIssue[] {
  const issues: WireIssue[] = [];
  for (const { instanceId, definition } of input.devices) {
    for (const pin of definition.pins.filter((candidate) => (candidate.maxCurrentMa ?? 0) > 0)) {
      const root = nets.find(devicePinKey(instanceId, pin.name));
      const members = byNet.get(root) ?? [];
      const loads = new Map<string, VirtualDevice>();
      for (const member of members) {
        if (member.deviceId && member.device && !member.device.powerSource && pinTypeOf(member) === 'vcc') {
          loads.set(member.deviceId, member.device);
        }
      }
      const total = [...loads.values()].reduce((sum, device) => sum + (device.supplyCurrentMa ?? 0), 0);
      if (total <= (pin.maxCurrentMa ?? 0)) continue;
      issues.push({
        id: `${root}:supply-overcurrent:${instanceId}:${pin.name}`,
        code: 'supply-overcurrent',
        severity: 'warning',
        title: 'กระแสรวมเกินพิกัดแหล่งจ่าย',
        detail: `โหลดบน ${definition.name}:${pin.name} ใช้กระแสโดยประมาณ ${total} mA แต่ขานี้จ่ายได้ ${pin.maxCurrentMa} mA ควรใช้แหล่งจ่ายภายนอกที่ต่อกราวด์ร่วมกัน`,
        deviceIds: [instanceId, ...loads.keys()],
        wireIds: wiresByNet.get(root) ?? [],
      });
    }
  }
  return issues;
}

/** Pins marked by their datasheet must have an external resistor to the correct rail. */
function checkMissingBiasResistors(
  input: ValidationInput,
  nets: NetBuilder,
  byNet: ReadonlyMap<string, NetMember[]>,
): readonly WireIssue[] {
  const issues: WireIssue[] = [];
  for (const { instanceId, definition } of input.devices) {
    for (const pin of definition.pins.filter((candidate) => candidate.requiresBias)) {
      const root = nets.find(devicePinKey(instanceId, pin.name));
      const signalMembers = byNet.get(root) ?? [];
      if (signalMembers.length < 2) continue;
      const biased = signalMembers.some((member) => {
        if (!member.device?.limitsCurrent || !member.deviceId || !member.pin) return false;
        return member.device.pins.some((otherPin) => {
          if (otherPin.name === member.pin?.name) return false;
          const otherMembers = byNet.get(nets.find(devicePinKey(member.deviceId!, otherPin.name))) ?? [];
          return otherMembers.some((candidate) =>
            pin.requiresBias === 'up' ? pinTypeOf(candidate) === 'vcc' : pinTypeOf(candidate) === 'gnd',
          );
        });
      });
      if (biased) continue;
      issues.push({
        id: `${devicePinKey(instanceId, pin.name)}:missing-${pin.requiresBias}`,
        code: `missing-pull-${pin.requiresBias}`,
        severity: 'warning',
        title: `ไม่มีตัวต้านทาน pull-${pin.requiresBias}`,
        detail: `${definition.name}:${pin.name} ต้องมีตัวต้านทาน pull-${pin.requiresBias} ภายนอกตาม datasheet เพื่อไม่ให้สัญญาณลอย`,
        deviceIds: [instanceId],
        wireIds: wiresForDevice(input, instanceId),
      });
    }
  }
  return issues;
}

/** A partly wired module cannot work when its required supply or ground is absent. */
function checkMissingRequiredPower(input: ValidationInput): readonly WireIssue[] {
  const connected = connectedPins(input);
  const issues: WireIssue[] = [];

  for (const { instanceId, definition } of input.devices) {
    if (definition.powerSource) continue;
    const pins = connected.get(instanceId);
    if (!pins?.size) continue;

    const missing = (['vcc', 'gnd'] as const).flatMap((type) => {
      const candidates = definition.pins.filter((pin) => pin.type === type);
      return candidates.length && candidates.every((pin) => !pins.has(pin.name))
        ? [candidates.map((pin) => pin.name).join(' / ')]
        : [];
    });
    if (!missing.length) continue;

    issues.push({
      id: `${instanceId}:missing-required-power`,
      code: 'missing-required-power',
      severity: 'error',
      title: 'ต่อไฟเลี้ยงอุปกรณ์ไม่ครบ',
      detail: `${definition.name} เริ่มมีการต่อวงจรแล้ว แต่ขา ${missing.join(' และ ')} ยังไม่ได้ต่อ อุปกรณ์จะไม่ทำงานจนกว่าจะต่อไฟเลี้ยงและกราวด์ครบ`,
      deviceIds: [instanceId],
      wireIds: wiresForDevice(input, instanceId),
    });
  }
  return issues;
}

/** Once one I2C line is used, both SDA and SCL are required on that device. */
function checkIncompleteI2cBus(input: ValidationInput): readonly WireIssue[] {
  const connected = connectedPins(input);
  const issues: WireIssue[] = [];

  for (const { instanceId, definition } of input.devices) {
    const busPins = definition.pins.filter(
      (pin) => pin.type === 'i2c-sda' || pin.type === 'i2c-scl',
    );
    if (!busPins.length) continue;
    const pins = connected.get(instanceId) ?? new Set<string>();
    const used = busPins.filter((pin) => pins.has(pin.name));
    if (!used.length) continue;

    const missingTypes = (['i2c-sda', 'i2c-scl'] as const).filter(
      (type) =>
        definition.pins.some((pin) => pin.type === type) &&
        !definition.pins.some((pin) => pin.type === type && pins.has(pin.name)),
    );
    if (!missingTypes.length) continue;

    issues.push({
      id: `${instanceId}:incomplete-i2c`,
      code: 'incomplete-i2c',
      severity: 'error',
      title: 'ต่อบัส I2C ไม่ครบ',
      detail: `${definition.name} ต่อ ${used.map((pin) => pin.name).join(', ')} แล้ว แต่ยังขาด ${missingTypes.map((type) => (type === 'i2c-sda' ? 'SDA' : 'SCL')).join(' และ ')} จึงสื่อสารกับบอร์ดไม่ได้`,
      deviceIds: [instanceId],
      wireIds: wiresForDevice(input, instanceId),
    });
  }
  return issues;
}

/** Two chips with one address on the same SDA/SCL pair answer simultaneously. */
function checkI2cAddressConflicts(
  input: ValidationInput,
  nets: NetBuilder,
): readonly WireIssue[] {
  const connected = connectedPins(input);
  const groups = new Map<
    string,
    { instanceId: string; name: string; address: string }[]
  >();

  for (const { instanceId, definition, properties } of input.devices) {
    const metadata = definition.i2cAddress;
    if (!metadata) continue;
    const pins = connected.get(instanceId) ?? new Set<string>();
    const sda = definition.pins.find(
      (pin) => pin.type === 'i2c-sda' && pins.has(pin.name),
    );
    const scl = definition.pins.find(
      (pin) => pin.type === 'i2c-scl' && pins.has(pin.name),
    );
    if (!sda || !scl) continue;

    const configured = metadata.property
      ? properties?.[metadata.property]
      : undefined;
    const address = String(configured ?? metadata.fallback).toUpperCase();
    const key = `${nets.find(devicePinKey(instanceId, sda.name))}|${nets.find(
      devicePinKey(instanceId, scl.name),
    )}|${address}`;
    const group = groups.get(key) ?? [];
    group.push({ instanceId, name: definition.name, address });
    groups.set(key, group);
  }

  return [...groups.entries()].flatMap(([key, devices]) => {
    if (devices.length < 2) return [];
    const ids = devices.map((device) => device.instanceId);
    return [
      {
        id: `${key}:i2c-address-conflict`,
        code: 'i2c-address-conflict',
        severity: 'error' as const,
        title: 'ที่อยู่ I2C ซ้ำกัน',
        detail: `${devices.map((device) => device.name).join(' และ ')} ใช้ที่อยู่ ${devices[0].address} บนบัสเดียวกัน ให้เปลี่ยน address ของหนึ่งอุปกรณ์หรือย้ายไปคนละบัส`,
        deviceIds: ids,
        wireIds: unique(ids.flatMap((id) => wiresForDevice(input, id))),
      },
    ];
  });
}

function connectedPins(input: ValidationInput): ReadonlyMap<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const wire of input.connections) {
    for (const endpoint of [wire.start, wire.end]) {
      if (endpoint.type !== 'device') continue;
      const pins = result.get(endpoint.deviceId) ?? new Set<string>();
      pins.add(endpoint.pinId);
      result.set(endpoint.deviceId, pins);
    }
  }
  return result;
}

function wiresForDevice(input: ValidationInput, instanceId: string): string[] {
  return input.connections
    .filter((wire) =>
      [wire.start, wire.end].some(
        (endpoint) => endpoint.type === 'device' && endpoint.deviceId === instanceId,
      ),
    )
    .map((wire) => wire.id);
}

/**
 * A part whose VCC and GND are wired to two different supplies.
 *
 * Current has to return to the supply it left, so a sensor fed from a board's
 * 3V3 but grounded only on a separate adapter never closes a loop, and the
 * simulator keeps it unpowered. Only direct wiring is judged: a net that reaches
 * no supply pin, or a ground net that joins two supplies' grounds, is left alone.
 */
function checkSplitSupply(
  input: ValidationInput,
  nets: NetBuilder,
  byNet: ReadonlyMap<string, NetMember[]>,
): readonly WireIssue[] {
  const suppliesOn = (instanceId: string, pinName: string, type: 'vcc' | 'gnd') => {
    const members = byNet.get(nets.find(devicePinKey(instanceId, pinName))) ?? [];
    const found = new Map<string, string>();
    for (const member of members) {
      if (!member.device?.powerSource || !member.deviceId || pinTypeOf(member) !== type) continue;
      const group = member.device.supplyGroup;
      found.set(group ?? member.deviceId, group ? 'สัญลักษณ์ VCC/GND' : member.device.name);
    }
    return found;
  };

  const issues: WireIssue[] = [];
  for (const { instanceId, definition } of input.devices) {
    if (definition.powerSource) continue;
    const groundPins = definition.pins.filter((pin) => pin.type === 'gnd');
    if (!groundPins.length) continue;

    const grounds = new Map<string, string>();
    for (const pin of groundPins) {
      for (const [id, name] of suppliesOn(instanceId, pin.name, 'gnd')) grounds.set(id, name);
    }
    if (!grounds.size) continue;

    for (const pin of definition.pins.filter((candidate) => candidate.type === 'vcc')) {
      const supplies = suppliesOn(instanceId, pin.name, 'vcc');
      if (!supplies.size || [...supplies.keys()].some((id) => grounds.has(id))) continue;

      issues.push({
        id: `${devicePinKey(instanceId, pin.name)}:split-supply`,
        code: 'split-supply',
        severity: 'warning',
        title: 'VCC กับ GND มาจากคนละแหล่งจ่าย',
        detail: `${definition.name}:${pin.name} รับไฟจาก ${[...supplies.values()].join(', ')} แต่ GND ต่อกับ ${[...grounds.values()].join(', ')} กระแสไม่มีทางไหลกลับแหล่งจ่ายเดิม อุปกรณ์จึงไม่ทำงาน ให้ต่อ GND เข้าแหล่งเดียวกับ VCC หรือต่อ GND ของทั้งสองแหล่งเข้าด้วยกัน`,
        deviceIds: [instanceId],
        wireIds: [],
      });
      break;
    }
  }
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

      const supply = members.find((member) => member.key !== key && railVoltsOf(member) > 0);
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
  const railVolts = Math.max(0, ...netMembers.map((member) => railVoltsOf(member)));
  if (railVolts <= 0) return [];

  const issues: WireIssue[] = [];
  for (const member of netMembers) {
    const range =
      member.device?.operatingVoltageFor?.(member.properties ?? {}) ??
      member.device?.operatingVoltage;
    const limit = range?.max;
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
  return member.pin?.type;
}

function describe(member: NetMember): string {
  return `${member.device?.name ?? member.deviceId}:${member.pin?.name}`;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}
