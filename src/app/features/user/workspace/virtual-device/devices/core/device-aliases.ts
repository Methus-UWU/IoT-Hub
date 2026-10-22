/**
 * Backwards compatibility for saved projects.
 *
 * A project stores a component as `definitionId` and a wire as a pair of
 * `pinId`s. Both are plain strings the server never validates, so renaming a
 * part or a pin in the catalog would silently orphan every diagram that used
 * it. Nothing here is cosmetic: this module is the reason an old project still
 * opens after the catalog is reorganised.
 *
 * The rule is one-directional. New ids never change to match old data; old ids
 * are translated forward on load. That keeps the alias table append-only and
 * stops it from becoming a second, competing naming scheme.
 */

import type { DeviceKind } from '../../device-library.models';
import type { DevicePin, VirtualDevice } from '../../models/virtual-device.model';

/**
 * Catalog ids that existed before a part was renamed or split.
 *
 * Entries are permanent. Deleting one does not tidy anything up — it breaks
 * every project saved while that id was current.
 */
export const LEGACY_DEVICE_IDS: Readonly<Record<string, DeviceKind>> = {
  // The workspace's original hard-coded board was the 38-pin DOIT layout.
  esp32: 'esp32-devkit-38',
  'esp32-devkit': 'esp32-devkit-38',
  'esp32-board': 'esp32-devkit-38',
  // Character displays were registered before the model number reached the id.
  lcd1602: 'lcd1602parallel',
  lcd2004: 'lcd2004parallel',
};

/**
 * Header pin ids of the retired hard-coded ESP32 board.
 *
 * That board was drawn straight into the canvas template with its own lowercase
 * pin ids. Its wires are migrated onto the `esp32-devkit-38` catalog part, and
 * this is the map that keeps each of them on the same physical hole.
 */
export const LEGACY_BOARD_PIN_IDS: Readonly<Record<string, string>> = {
  '3v3': '3V3',
  en: 'EN',
  vin: 'VIN',
  'gnd-left': 'GND-L',
  'gnd-right': 'GND-R1',
  'gnd-right-b': 'GND-R2',
};

/** Resolves a stored component id to a live catalog id. */
export function resolveDeviceId(stored: string): DeviceKind {
  return LEGACY_DEVICE_IDS[stored] ?? stored;
}

/** Resolves a pin id from the retired board to its `esp32-devkit-38` hole. */
export function resolveBoardPinId(stored: string): string {
  const mapped = LEGACY_BOARD_PIN_IDS[stored];
  if (mapped) return mapped;
  // Everything else was `gpio<n>`, which became `GPIO<n>`.
  const gpio = /^gpio(\d+)$/.exec(stored);
  return gpio ? `GPIO${gpio[1]}` : stored.toUpperCase();
}

/**
 * Finds a pin by its id, then by any silkscreen name it also answers to.
 *
 * A wire saved against `D23` has to keep landing on `GPIO23` after the pin was
 * renamed to its GPIO number, and `aliases` is where a part records exactly
 * that. Matching is case-insensitive because the old board printed lowercase.
 */
export function findPin(device: VirtualDevice, pinId: string): DevicePin | undefined {
  const direct = device.pins.find((devicePin) => devicePin.name === pinId);
  if (direct) return direct;

  const wanted = pinId.toLocaleLowerCase();
  return device.pins.find(
    (devicePin) =>
      devicePin.name.toLocaleLowerCase() === wanted ||
      devicePin.aliases?.some((alias) => alias.toLocaleLowerCase() === wanted),
  );
}
