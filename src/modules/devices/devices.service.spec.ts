import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';

import type { Datastream } from '../dashboards/dashboard.repository';
import type { DashboardsService } from '../dashboards/dashboards.service';
import {
  DeviceRecord,
  DeviceRepository,
  DeviceValueRecord,
  NewTelemetryPoint,
  TelemetryPointRecord,
  TelemetryValue,
} from './device.repository';
import {
  DevicesService,
  MAX_DEVICES_PER_PROJECT,
  hashDeviceToken,
} from './devices.service';
import {
  CHART_POINTS,
  TelemetryService,
  downsample,
} from './telemetry.service';

const PROJECT = 'project-1';
const OTHER = 'project-2';

class FakeDevices extends DeviceRepository {
  readonly rows: (DeviceRecord & { tokenHash: string })[] = [];
  readonly values = new Map<string, DeviceValueRecord[]>();
  readonly points: (NewTelemetryPoint & {
    deviceId: string;
    recordedAt: Date;
  })[] = [];
  touches = 0;

  list(projectId: string) {
    return Promise.resolve(
      this.rows.filter((row) => row.projectId === projectId),
    );
  }
  find(id: string) {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }
  findByTokenHash(tokenHash: string) {
    return Promise.resolve(
      this.rows.find((row) => row.tokenHash === tokenHash) ?? null,
    );
  }
  count(projectId: string) {
    return Promise.resolve(
      this.rows.filter((row) => row.projectId === projectId).length,
    );
  }
  create(input: {
    projectId: string;
    name: string;
    tokenHash: string;
    tokenHint: string;
  }) {
    const row = {
      id: randomUUID(),
      lastSeenAt: null,
      createdAt: new Date(),
      ...input,
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }
  rename(id: string, name: string) {
    const row = this.rows.find((entry) => entry.id === id)!;
    row.name = name;
    return Promise.resolve(row);
  }
  replaceToken(id: string, tokenHash: string, tokenHint: string) {
    const row = this.rows.find((entry) => entry.id === id)!;
    Object.assign(row, { tokenHash, tokenHint });
    return Promise.resolve(row);
  }
  delete(id: string) {
    this.rows.splice(
      this.rows.findIndex((row) => row.id === id),
      1,
    );
    return Promise.resolve();
  }
  touch(id: string, at: Date) {
    this.touches++;
    this.rows.find((row) => row.id === id)!.lastSeenAt = at;
    return Promise.resolve();
  }
  latestValues(deviceId: string) {
    return Promise.resolve(this.values.get(deviceId) ?? []);
  }
  writeValues(
    deviceId: string,
    values: { key: string; value: TelemetryValue; source: 'device' | 'app' }[],
    points: NewTelemetryPoint[],
  ) {
    const current = this.values.get(deviceId) ?? [];
    for (const entry of values) {
      const next = current.filter((row) => row.key !== entry.key);
      next.push({ ...entry, updatedAt: new Date() });
      current.splice(0, current.length, ...next);
    }
    this.values.set(deviceId, current);
    this.points.push(
      ...points.map((point) => ({
        ...point,
        deviceId,
        recordedAt: new Date(),
      })),
    );
    return Promise.resolve();
  }
  series(
    deviceId: string,
    key: string,
    since: Date,
    limit: number,
  ): Promise<TelemetryPointRecord[]> {
    return Promise.resolve(
      this.points
        .filter(
          (point) =>
            point.deviceId === deviceId &&
            point.key === key &&
            point.recordedAt >= since,
        )
        .slice(-limit),
    );
  }
  prune() {
    return Promise.resolve(0);
  }
}

const stream = (key: string, dataType: Datastream['dataType']): Datastream => ({
  id: key,
  key,
  name: key,
  dataType,
  unit: '',
  min: null,
  max: null,
  source: '',
  componentId: null,
});

describe('devices and telemetry', () => {
  let repository: FakeDevices;
  let devices: DevicesService;
  let telemetry: TelemetryService;

  beforeEach(() => {
    repository = new FakeDevices();
    devices = new DevicesService(repository);
    const dashboards = {
      listDatastreams: () =>
        Promise.resolve([
          stream('temperature', 'number'),
          stream('relay', 'boolean'),
          stream('status', 'string'),
        ]),
    } as unknown as DashboardsService;
    telemetry = new TelemetryService(repository, devices, dashboards);
  });

  it('stores only a hash of the token, and a rotated token replaces the old one', async () => {
    const { device, token } = await devices.create(
      PROJECT,
      'Living room ESP32',
      'user',
    );
    expect(token).toMatch(/^iot_[A-Za-z0-9_-]{32}$/);
    expect(device.tokenHint).toBe(token.slice(-4));
    expect(repository.rows[0].tokenHash).toBe(hashDeviceToken(token));
    expect(JSON.stringify(repository.rows)).not.toContain(token);
    expect((await devices.authenticate(token))?.id).toBe(device.id);

    const rotated = await devices.rotateToken(PROJECT, device.id);
    expect(await devices.authenticate(token)).toBeNull();
    expect((await devices.authenticate(rotated.token))?.id).toBe(device.id);
  });

  it('keeps devices inside their project and caps how many a project has', async () => {
    const { device } = await devices.create(PROJECT, 'A', 'user');
    await expect(devices.rename(OTHER, device.id, 'B')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(telemetry.snapshot(OTHER, device.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    for (let index = 1; index < MAX_DEVICES_PER_PROJECT; index++) {
      await devices.create(PROJECT, `D${index}`, 'user');
    }
    await expect(
      devices.create(PROJECT, 'one more', 'user'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts reports that match the datastreams and rejects the rest', async () => {
    const { device } = await devices.create(PROJECT, 'A', 'user');
    const record = (await repository.find(device.id))!;
    const now = new Date('2026-10-11T10:00:00Z');

    const outcome = await telemetry.report(
      record,
      { temperature: 24.5, relay: 1, status: 'ok', humidity: 50, unknown: 'x' },
      now,
    );
    const bad = await telemetry.report(
      record,
      { temperature: 'hot', relay: 'yes' },
      new Date(now.getTime() + 2000),
    );

    expect(outcome.accepted).toEqual(['temperature', 'relay', 'status']);
    expect(outcome.rejected.map((entry) => entry.key)).toEqual([
      'humidity',
      'unknown',
    ]);
    expect(bad.accepted).toEqual([]);
    const snapshot = await telemetry.snapshot(
      PROJECT,
      device.id,
      new Date(now.getTime() + 30_000),
    );
    expect(snapshot.online).toBe(true);
    expect(snapshot.values['relay'].value).toBe(true);
    expect(
      repository.points.map((point) => [point.key, point.value, point.text]),
    ).toEqual([
      ['temperature', 24.5, null],
      ['relay', 1, null],
      ['status', null, 'ok'],
    ]);
    const later = await telemetry.snapshot(
      PROJECT,
      device.id,
      new Date(now.getTime() + 120_000),
    );
    expect(later.online).toBe(false);
  });

  it('limits each device to bursts of reports, then one per second', async () => {
    const { device } = await devices.create(PROJECT, 'A', 'user');
    const record = (await repository.find(device.id))!;
    const at = new Date('2026-10-11T10:00:00Z');
    for (let index = 0; index < 10; index++)
      await telemetry.report(record, {}, at);
    await expect(telemetry.report(record, {}, at)).rejects.toBeInstanceOf(
      HttpException,
    );
    await expect(
      telemetry.report(record, {}, new Date(at.getTime() + 1000)),
    ).resolves.toBeDefined();
    // last_seen_at is written once per ten seconds, not on every report.
    expect(repository.touches).toBe(1);
  });

  it('passes dashboard controls to the device, checked against the datastream type', async () => {
    const { device } = await devices.create(PROJECT, 'A', 'user');
    await telemetry.setControl(PROJECT, device.id, 'relay', true);
    await expect(
      telemetry.setControl(PROJECT, device.id, 'relay', 'on'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      telemetry.setControl(PROJECT, device.id, 'missing', 1),
    ).rejects.toBeInstanceOf(NotFoundException);
    const record = (await repository.find(device.id))!;
    expect(await telemetry.controls(record)).toEqual({
      values: { relay: true },
    });
    // A control is not history.
    expect(repository.points).toEqual([]);
  });

  it('averages a long history into chart points', () => {
    const points = Array.from({ length: 1000 }, (_, index) => ({
      at: new Date(index * 1000),
      value: index,
    }));
    const result = downsample(points, CHART_POINTS);
    expect(result).toHaveLength(CHART_POINTS);
    expect(result[0].value).toBeCloseTo(3.5, 1);
    expect(result.at(-1)?.at).toEqual(points.at(-1)?.at);
  });
});
