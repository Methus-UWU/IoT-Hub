import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

import {
  DeviceSnapshot,
  DeviceView,
  DevicesApiClient,
  TelemetryRange,
  TelemetryValue,
} from './devices-api.client';

/** Latest values are read this often while the dashboard is live and visible. */
export const LIVE_POLL_MS = 5000;
/** Chart history changes slowly; it is read every sixth poll. */
const SERIES_EVERY = 6;

interface LiveTarget {
  projectId: string;
  deviceId: string;
  keys: string[];
  range: TelemetryRange;
}

/**
 * Live data for the dashboard page: the project's devices, the selected device's
 * latest values, and the history its charts draw.
 *
 * It polls only while the page is live and the tab is visible, and stops when the page
 * goes. A control's value is shown at once and then confirmed by the next poll.
 */
@Injectable()
export class DashboardLive {
  private readonly api = inject(DevicesApiClient);
  private readonly document = inject(DOCUMENT);

  readonly devices = signal<DeviceView[]>([]);
  readonly devicesLoaded = signal(false);
  readonly snapshot = signal<DeviceSnapshot | null>(null);
  /** Chart values per datastream key, oldest first. */
  readonly series = signal<Record<string, number[]>>({});
  readonly failed = signal(false);

  private target: LiveTarget | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polls = 0;
  private generation = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  async loadDevices(projectId: string): Promise<void> {
    try {
      this.devices.set(await this.api.list(projectId));
    } catch {
      this.devices.set([]);
    } finally {
      this.devicesLoaded.set(true);
    }
  }

  /** Starts, retargets, or keeps polling; the same target is a no-op. */
  watch(target: LiveTarget): void {
    const same =
      this.target &&
      this.target.projectId === target.projectId &&
      this.target.deviceId === target.deviceId &&
      this.target.range === target.range &&
      this.target.keys.join() === target.keys.join();
    if (same && this.timer) return;
    const deviceChanged = this.target?.deviceId !== target.deviceId;
    this.target = target;
    this.generation++;
    if (deviceChanged) {
      this.snapshot.set(null);
      this.series.set({});
    }
    this.polls = 0;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.poll(), LIVE_POLL_MS);
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.target = null;
    this.generation++;
  }

  /** Sends a control value; shows it at once and rolls back if the server refuses. */
  async setControl(key: string, value: TelemetryValue): Promise<void> {
    const target = this.target;
    if (!target) return;
    const previous = this.snapshot();
    if (previous) {
      this.snapshot.set({
        ...previous,
        values: {
          ...previous.values,
          [key]: { value, source: 'app', updatedAt: new Date().toISOString() },
        },
      });
    }
    try {
      await this.api.setControl(target.projectId, target.deviceId, key, value);
    } catch (error: unknown) {
      if (this.target === target) this.snapshot.set(previous);
      throw error;
    }
  }

  private async poll(): Promise<void> {
    const target = this.target;
    if (!target || this.document.visibilityState === 'hidden') return;
    const generation = this.generation;
    const readSeries = this.polls % SERIES_EVERY === 0;
    this.polls++;
    try {
      const [snapshot, series] = await Promise.all([
        this.api.snapshot(target.projectId, target.deviceId),
        readSeries
          ? Promise.all(
              target.keys.map((key) =>
                this.api.series(target.projectId, target.deviceId, key, target.range),
              ),
            )
          : Promise.resolve(null),
      ]);
      if (generation !== this.generation) return;
      this.snapshot.set(snapshot);
      this.devices.update((devices) =>
        devices.map((device) =>
          device.id === snapshot.deviceId
            ? { ...device, online: snapshot.online, lastSeenAt: snapshot.lastSeenAt }
            : device,
        ),
      );
      if (series) {
        this.series.set(
          Object.fromEntries(series.map((entry) => [entry.key, entry.points.map((p) => p.value)])),
        );
      }
      this.failed.set(false);
    } catch {
      if (generation === this.generation) this.failed.set(true);
    }
  }
}
