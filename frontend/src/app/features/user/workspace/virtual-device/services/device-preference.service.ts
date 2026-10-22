import { Service, signal } from '@angular/core';

import type { DeviceKind } from '../device-library.models';
import { isDeviceKind } from '../devices/device-catalog';

const FAVORITES_KEY = 'iot-hub.virtual-device.favorites';
const RECENT_KEY = 'iot-hub.virtual-device.recent';
const RECENT_LIMIT = 8;

function readIds(key: string): readonly DeviceKind[] {
  try {
    const stored = globalThis.localStorage?.getItem(key);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isDeviceKind) : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: readonly DeviceKind[]): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

/** Persists the Add Device modal's favourite and recently-used lists. */
@Service()
export class DevicePreferenceService {
  private readonly favoriteIds = signal<readonly DeviceKind[]>(readIds(FAVORITES_KEY));
  private readonly recentIds = signal<readonly DeviceKind[]>(readIds(RECENT_KEY));

  readonly favorites = this.favoriteIds.asReadonly();
  readonly recents = this.recentIds.asReadonly();

  toggleFavorite(id: DeviceKind): void {
    const current = this.favoriteIds();
    const next = current.includes(id)
      ? current.filter((deviceId) => deviceId !== id)
      : [...current, id];
    this.favoriteIds.set(next);
    writeIds(FAVORITES_KEY, next);
  }

  markRecentlyUsed(id: DeviceKind): void {
    const next = [id, ...this.recentIds().filter((deviceId) => deviceId !== id)].slice(
      0,
      RECENT_LIMIT,
    );
    this.recentIds.set(next);
    writeIds(RECENT_KEY, next);
  }
}
