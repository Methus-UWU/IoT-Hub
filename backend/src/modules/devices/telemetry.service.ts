import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { Datastream } from '../dashboards/dashboard.repository';
import { DashboardsService } from '../dashboards/dashboards.service';
import {
  DeviceRecord,
  DeviceRepository,
  NewTelemetryPoint,
  TelemetryValue,
} from './device.repository';
import { DevicesService, isOnline } from './devices.service';

export const TELEMETRY_RANGES = ['1h', '24h', '7d', '30d'] as const;
export type TelemetryRange = (typeof TELEMETRY_RANGES)[number];

const RANGE_MS: Record<TelemetryRange, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};
/** History is kept this long. */
export const RETENTION_MS = RANGE_MS['30d'];
/** Values per report. */
export const MAX_VALUES_PER_REPORT = 32;
const MAX_TEXT = 256;
/** Rows read for one chart, then averaged down to at most CHART_POINTS. */
const SERIES_READ_LIMIT = 5000;
export const CHART_POINTS = 120;
/** Each device may report this often; faster reports are refused with 429. */
const REPORT_BURST = 10;
const REPORT_REFILL_MS = 1000;
/** last_seen_at is written at most this often per device. */
const TOUCH_INTERVAL_MS = 10_000;
const PRUNE_INTERVAL_MS = 3_600_000;

export interface ReportOutcome {
  accepted: string[];
  /** Keys the project has no datastream for, or whose value has the wrong type. */
  rejected: { key: string; reason: string }[];
}

export interface DeviceSnapshot {
  deviceId: string;
  online: boolean;
  lastSeenAt: Date | null;
  values: Record<
    string,
    { value: TelemetryValue; source: 'device' | 'app'; updatedAt: Date }
  >;
}

export interface SeriesPoint {
  at: Date;
  value: number;
}

/**
 * Telemetry: what devices report, what dashboards read, and what controls set.
 *
 * A report is checked against the project's datastreams — the key must exist and the
 * value must have its type — so a device cannot invent fields or write a string into
 * a gauge. Control values go the other way: a dashboard sets them and the device reads
 * them on its next poll.
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly touched = new Map<string, number>();
  private lastPrune = 0;

  constructor(
    private readonly devices: DeviceRepository,
    private readonly deviceService: DevicesService,
    private readonly dashboards: DashboardsService,
  ) {}

  /** A device's report: `{ key: value }` for the project's datastreams. */
  async report(
    device: DeviceRecord,
    values: Record<string, unknown>,
    now = new Date(),
  ): Promise<ReportOutcome> {
    this.limit(device.id, now.getTime());
    const entries = Object.entries(values);
    if (entries.length > MAX_VALUES_PER_REPORT) {
      throw new BadRequestException({
        code: 'TELEMETRY_TOO_MANY_VALUES',
        message: `Report up to ${MAX_VALUES_PER_REPORT} values at a time`,
      });
    }

    const streams = await this.streams(device.projectId);
    const outcome: ReportOutcome = { accepted: [], rejected: [] };
    const latest: { key: string; value: TelemetryValue; source: 'device' }[] =
      [];
    const points: NewTelemetryPoint[] = [];
    for (const [key, raw] of entries) {
      const stream = streams.get(key);
      if (!stream) {
        outcome.rejected.push({ key, reason: 'No datastream with this key' });
        continue;
      }
      const value = coerce(stream, raw);
      if (value === null) {
        outcome.rejected.push({ key, reason: `Expected a ${stream.dataType}` });
        continue;
      }
      latest.push({ key, value, source: 'device' });
      points.push(
        typeof value === 'string'
          ? { key, value: null, text: value }
          : {
              key,
              value: typeof value === 'boolean' ? Number(value) : value,
              text: null,
            },
      );
      outcome.accepted.push(key);
    }

    if (latest.length)
      await this.devices.writeValues(device.id, latest, points);
    await this.heard(device.id, now);
    void this.pruneOccasionally(now);
    return outcome;
  }

  /** What dashboard controls set, for the device to apply. */
  async controls(
    device: DeviceRecord,
    now = new Date(),
  ): Promise<{ values: Record<string, TelemetryValue> }> {
    await this.heard(device.id, now);
    const values: Record<string, TelemetryValue> = {};
    for (const row of await this.devices.latestValues(device.id)) {
      if (row.source === 'app') values[row.key] = row.value;
    }
    return { values };
  }

  async snapshot(
    projectId: string,
    deviceId: string,
    now = new Date(),
  ): Promise<DeviceSnapshot> {
    const device = await this.deviceService.require(projectId, deviceId);
    const values: DeviceSnapshot['values'] = {};
    for (const row of await this.devices.latestValues(deviceId)) {
      values[row.key] = {
        value: row.value,
        source: row.source,
        updatedAt: row.updatedAt,
      };
    }
    return {
      deviceId,
      online: isOnline(device, now),
      lastSeenAt: device.lastSeenAt,
      values,
    };
  }

  /** A datastream's history, averaged into at most CHART_POINTS points. */
  async series(
    projectId: string,
    deviceId: string,
    key: string,
    range: TelemetryRange,
    now = new Date(),
  ): Promise<{ key: string; range: TelemetryRange; points: SeriesPoint[] }> {
    await this.deviceService.require(projectId, deviceId);
    const since = new Date(now.getTime() - RANGE_MS[range]);
    const rows = await this.devices.series(
      deviceId,
      key,
      since,
      SERIES_READ_LIMIT,
    );
    const numeric = rows.flatMap((row) =>
      row.value === null ? [] : [{ at: row.recordedAt, value: row.value }],
    );
    return { key, range, points: downsample(numeric, CHART_POINTS) };
  }

  /** A dashboard control sets a value; the device reads it from `controls`. */
  async setControl(
    projectId: string,
    deviceId: string,
    key: string,
    raw: unknown,
  ): Promise<{ key: string; value: TelemetryValue }> {
    await this.deviceService.require(projectId, deviceId);
    const stream = (await this.streams(projectId)).get(key);
    if (!stream) {
      throw new NotFoundException({
        code: 'DATASTREAM_NOT_FOUND',
        message: 'The project has no datastream with this key',
      });
    }
    const value = coerce(stream, raw);
    if (value === null) {
      throw new BadRequestException({
        code: 'TELEMETRY_INVALID_VALUE',
        message: `Expected a ${stream.dataType}`,
      });
    }
    await this.devices.writeValues(
      deviceId,
      [{ key, value, source: 'app' }],
      [],
    );
    return { key, value };
  }

  private async streams(projectId: string): Promise<Map<string, Datastream>> {
    const list = await this.dashboards.listDatastreams(projectId);
    return new Map(list.map((stream) => [stream.key, stream]));
  }

  /** A token bucket per device: bursts of REPORT_BURST, then one per second. */
  private limit(deviceId: string, now: number): void {
    const bucket = this.buckets.get(deviceId) ?? {
      tokens: REPORT_BURST,
      at: now,
    };
    const refilled = Math.min(
      REPORT_BURST,
      bucket.tokens + (now - bucket.at) / REPORT_REFILL_MS,
    );
    if (refilled < 1) {
      throw new HttpException(
        {
          code: 'TELEMETRY_RATE_LIMITED',
          message: 'Report at most once per second',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.buckets.set(deviceId, { tokens: refilled - 1, at: now });
  }

  private async heard(deviceId: string, now: Date): Promise<void> {
    const last = this.touched.get(deviceId) ?? 0;
    if (now.getTime() - last < TOUCH_INTERVAL_MS) return;
    this.touched.set(deviceId, now.getTime());
    await this.devices.touch(deviceId, now);
  }

  private async pruneOccasionally(now: Date): Promise<void> {
    if (now.getTime() - this.lastPrune < PRUNE_INTERVAL_MS) return;
    this.lastPrune = now.getTime();
    try {
      await this.devices.prune(new Date(now.getTime() - RETENTION_MS));
    } catch (error: unknown) {
      this.logger.warn(
        `Telemetry retention failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

/** The value in the datastream's type, or null when it does not fit. */
export function coerce(
  stream: Datastream,
  raw: unknown,
): TelemetryValue | null {
  switch (stream.dataType) {
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 0 || raw === 1) return raw === 1;
      return null;
    case 'string':
      return typeof raw === 'string' && raw.length <= MAX_TEXT ? raw : null;
  }
}

/** Averages consecutive points into at most `limit` buckets. */
export function downsample(
  points: SeriesPoint[],
  limit: number,
): SeriesPoint[] {
  if (points.length <= limit) return points;
  const size = points.length / limit;
  const result: SeriesPoint[] = [];
  for (let bucket = 0; bucket < limit; bucket++) {
    const slice = points.slice(
      Math.floor(bucket * size),
      Math.floor((bucket + 1) * size),
    );
    if (!slice.length) continue;
    const value =
      slice.reduce((sum, point) => sum + point.value, 0) / slice.length;
    result.push({ at: slice[slice.length - 1].at, value });
  }
  return result;
}
