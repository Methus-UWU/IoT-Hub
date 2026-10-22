import type { BusMessage, BusValue, DeviceSimulationContext } from './device-simulation';

/** Publish a role on every signal: a missing/swapped clock or CS must fail. */
export function publishBus(
  context: DeviceSimulationContext,
  pins: Readonly<Record<string, string>>,
  protocol: string,
  data: Readonly<Record<string, BusValue>>,
): void {
  for (const [role, pin] of Object.entries(pins)) context.publish(pin, protocol, { ...data, role });
}

/** All signal roles must arrive from the same sender and transaction. */
export function readBus(
  read: (pin: string) => readonly BusMessage[],
  pins: Readonly<Record<string, string | null>>,
  protocol: string,
  busKey?: string,
): BusMessage | undefined {
  const entries = Object.entries(pins);
  const [firstRole, firstPin] = entries[0] ?? [];
  if (!firstPin || entries.some(([, pin]) => !pin)) return undefined;
  const candidates = read(firstPin).filter(
    (message) =>
      message.protocol === protocol &&
      message.data['role'] === firstRole &&
      (busKey === undefined || message.data['busKey'] === busKey),
  );
  const matches = candidates.filter((candidate) =>
    entries.every(([role, pin]) =>
      read(pin!).some(
        (message) =>
          message.from === candidate.from &&
          message.protocol === protocol &&
          message.data['role'] === role &&
          message.data['busKey'] === candidate.data['busKey'],
      ),
    ),
  );
  // A collision is not a valid reply.
  return matches.length === 1 ? matches[0] : undefined;
}

export function readBusFrame(
  context: DeviceSimulationContext,
  pins: Readonly<Record<string, string>>,
  protocol: string,
) {
  return readBus((pin) => context.readNode(pin).messages ?? [], pins, protocol);
}
