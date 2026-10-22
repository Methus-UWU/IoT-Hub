import { readBus } from '../../../devices/core/multi-pin-bus';
import type { BusValue } from '../../../devices/core/device-simulation';
import type { LibraryHost } from '../firmware-values';

export function busReply(
  host: LibraryHost,
  pins: Readonly<Record<string, string | null>>,
  protocol: string,
  busKey?: string,
) {
  return readBus((pin) => host.messages(pin), pins, protocol, busKey);
}

export function sendBus(
  host: LibraryHost,
  pins: Readonly<Record<string, string | null>>,
  protocol: string,
  data: Readonly<Record<string, BusValue>>,
): number {
  if (Object.values(pins).some((pin) => !pin)) return 0;
  const busKey = Object.entries(pins)
    .map(([role, pin]) => `${role}:${pin}`)
    .join('|');
  for (const [role, pin] of Object.entries(pins))
    host.publish(pin!, `${protocol}:${busKey}`, protocol, { ...data, role, busKey });
  return 0;
}

export function i2cBus(host: LibraryHost) {
  const pins = host.i2cPins();
  return { data: pins.sda, clock: pins.scl };
}
