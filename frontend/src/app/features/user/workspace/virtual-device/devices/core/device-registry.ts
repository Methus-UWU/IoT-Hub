/**
 * Central device registry.
 *
 * Parts register themselves here and everything else — the canvas, the library
 * modal, the thumbnail renderer, the preference service — reads through this
 * module. Adding a catalog part means writing one device file and listing it in
 * `devices/device-catalog.ts`; no other file needs to change.
 */

import {
  deviceCategoryLabel,
  type DeviceCategoryId,
  type DeviceKind,
  type DeviceLibraryItem,
} from '../../device-library.models';
import type { VirtualDevice } from '../../models/virtual-device.model';
import { INTERFACE_LABELS, interfacesForPinTypes, type DeviceInterface } from './device-types';

const registry = new Map<DeviceKind, VirtualDevice>();

/**
 * Registers one part. Duplicate ids are a programming error — two parts sharing
 * an id would make wires ambiguous after a save/reload — so the later
 * registration is rejected rather than silently overwriting the earlier one.
 */
export function registerDevice(device: VirtualDevice): VirtualDevice {
  if (registry.has(device.id)) {
    throw new Error(`Duplicate device id "${device.id}" in the catalog registry.`);
  }
  assertUniquePinIds(device);
  registry.set(device.id, device);
  return device;
}

export function registerDevices(devices: readonly VirtualDevice[]): readonly VirtualDevice[] {
  for (const device of devices) registerDevice(device);
  return devices;
}

export function unregisterDevice(id: DeviceKind): boolean {
  return registry.delete(id);
}

export function getDevice(id: DeviceKind): VirtualDevice | undefined {
  return registry.get(id);
}

export function isRegisteredDevice(value: unknown): value is DeviceKind {
  return typeof value === 'string' && registry.has(value);
}

export function allDevices(): readonly VirtualDevice[] {
  return [...registry.values()];
}

export function devicesInCategory(categoryId: DeviceCategoryId): readonly VirtualDevice[] {
  return allDevices().filter((device) => device.catalog.categoryId === categoryId);
}

export function devicesWithInterface(target: DeviceInterface): readonly VirtualDevice[] {
  return allDevices().filter((device) => deviceInterfaces(device).includes(target));
}

export function devicesForVoltage(volts: number): readonly VirtualDevice[] {
  return allDevices().filter((device) => {
    const range = device.operatingVoltage;
    return !range || (volts >= range.min && volts <= range.max);
  });
}

/**
 * Declared interfaces win; otherwise they are inferred from the pin types, so a
 * part that lists an SDA and SCL pin gets an "I2C" badge for free.
 */
export function deviceInterfaces(device: VirtualDevice): readonly DeviceInterface[] {
  if (device.interfaces?.length) return device.interfaces;
  const pinTypes = device.pins.flatMap((devicePin) => (devicePin.type ? [devicePin.type] : []));
  return interfacesForPinTypes(pinTypes);
}

/** Short badges for the library card. Kept to a handful so cards stay clean. */
export function deviceBadges(device: VirtualDevice): readonly string[] {
  const badges = deviceInterfaces(device)
    .filter((name) => name !== 'digital')
    .map((name) => INTERFACE_LABELS[name]);

  const voltage = device.operatingVoltage?.recommended;
  if (voltage !== undefined) badges.push(`${voltage} V`);

  return badges.slice(0, 4);
}

/**
 * Popularity ranking for the "popular" quick filter. Explicit ordering beats a
 * usage counter here: a brand-new workspace should still surface the parts a
 * beginner actually needs first.
 */
const POPULAR_ORDER: readonly DeviceKind[] = [
  'esp32-devkit-v1',
  'arduino-uno-r3',
  'led',
  'resistor',
  'push-button',
  'button',
  'breadboard-half',
  'lcd',
  'ultrasonic',
  'servo',
  'dht22',
  'potentiometer',
  'relay',
  'pir-hc-sr501',
  'oled-096-i2c',
  'buzzer-active',
  'ir-obstacle',
  'tm1637-display',
  'max7219-matrix',
  'rtc-ds1307',
  'rfid-rc522',
  'tft-ili9341-touch',
  'bme280',
];

export function devicePopularity(id: DeviceKind): number {
  const index = POPULAR_ORDER.indexOf(id);
  return index === -1 ? 0 : POPULAR_ORDER.length - index;
}

/** Catalog projection consumed by the Add Device modal. */
export function toLibraryItem(device: VirtualDevice): DeviceLibraryItem {
  return {
    id: device.id,
    name: device.name,
    model: device.model,
    description: device.description,
    pinCount: device.pins.length,
    categoryId: device.catalog.categoryId,
    category: deviceCategoryLabel(device.catalog.categoryId),
    aliases: device.catalog.aliases,
    tags: device.catalog.tags,
    interfaceLabel: device.catalog.interfaceLabel,
    typicalUsage: device.catalog.typicalUsage,
    badges: deviceBadges(device),
    popularity: devicePopularity(device.id),
  };
}

export function libraryItems(): readonly DeviceLibraryItem[] {
  return allDevices().map(toLibraryItem);
}

/**
 * Pin names double as wire endpoint ids, so a duplicate inside one part would
 * make a saved wire reconnect to the wrong hole on reload.
 */
function assertUniquePinIds(device: VirtualDevice): void {
  const seen = new Set<string>();
  for (const devicePin of device.pins) {
    if (seen.has(devicePin.name)) {
      throw new Error(`Device "${device.id}" declares pin "${devicePin.name}" more than once.`);
    }
    seen.add(devicePin.name);
  }
}
