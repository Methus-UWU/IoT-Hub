import { Injectable } from '@nestjs/common';

import type { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DeviceRecord,
  DeviceRepository,
  DeviceValueRecord,
  NewTelemetryPoint,
  TelemetryPointRecord,
  TelemetryValue,
} from './device.repository';

const DEVICE_SELECT = {
  id: true,
  projectId: true,
  name: true,
  tokenHint: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

@Injectable()
export class PrismaDeviceRepository extends DeviceRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  list(projectId: string): Promise<DeviceRecord[]> {
    return this.prisma.db.device.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: DEVICE_SELECT,
    });
  }

  find(id: string): Promise<DeviceRecord | null> {
    return this.prisma.db.device.findUnique({
      where: { id },
      select: DEVICE_SELECT,
    });
  }

  findByTokenHash(tokenHash: string): Promise<DeviceRecord | null> {
    return this.prisma.db.device.findUnique({
      where: { tokenHash },
      select: DEVICE_SELECT,
    });
  }

  count(projectId: string): Promise<number> {
    return this.prisma.db.device.count({ where: { projectId } });
  }

  create(input: {
    projectId: string;
    name: string;
    tokenHash: string;
    tokenHint: string;
    createdBy: string;
  }): Promise<DeviceRecord> {
    return this.prisma.db.device.create({ data: input, select: DEVICE_SELECT });
  }

  rename(id: string, name: string): Promise<DeviceRecord> {
    return this.prisma.db.device.update({
      where: { id },
      data: { name },
      select: DEVICE_SELECT,
    });
  }

  replaceToken(
    id: string,
    tokenHash: string,
    tokenHint: string,
  ): Promise<DeviceRecord> {
    return this.prisma.db.device.update({
      where: { id },
      data: { tokenHash, tokenHint },
      select: DEVICE_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.db.device.deleteMany({ where: { id } });
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.prisma.db.device.updateMany({
      where: { id },
      data: { lastSeenAt: at },
    });
  }

  async latestValues(deviceId: string): Promise<DeviceValueRecord[]> {
    const rows = await this.prisma.db.deviceValue.findMany({
      where: { deviceId },
      orderBy: { key: 'asc' },
    });
    return rows.map((row) => ({
      key: row.key,
      value: row.value as TelemetryValue,
      source: row.source === 'app' ? 'app' : 'device',
      updatedAt: row.updatedAt,
    }));
  }

  async writeValues(
    deviceId: string,
    values: { key: string; value: TelemetryValue; source: 'device' | 'app' }[],
    points: NewTelemetryPoint[],
  ): Promise<void> {
    const database = this.prisma.db as Pick<PrismaClient, '$transaction'>;
    const now = new Date();
    await database.$transaction(async (tx) => {
      for (const entry of values) {
        await tx.deviceValue.upsert({
          where: { deviceId_key: { deviceId, key: entry.key } },
          create: {
            deviceId,
            key: entry.key,
            value: entry.value,
            source: entry.source,
            updatedAt: now,
          },
          update: {
            value: entry.value,
            source: entry.source,
            updatedAt: now,
          },
        });
      }
      if (points.length) {
        await tx.telemetryPoint.createMany({
          data: points.map((point) => ({
            ...point,
            deviceId,
            recordedAt: now,
          })),
        });
      }
    });
  }

  async series(
    deviceId: string,
    key: string,
    since: Date,
    limit: number,
  ): Promise<TelemetryPointRecord[]> {
    const rows = await this.prisma.db.telemetryPoint.findMany({
      where: { deviceId, key, recordedAt: { gte: since } },
      orderBy: { recordedAt: 'desc' },
      take: limit,
      select: { value: true, text: true, recordedAt: true },
    });
    return rows.reverse();
  }

  async prune(before: Date): Promise<number> {
    const result = await this.prisma.db.telemetryPoint.deleteMany({
      where: { recordedAt: { lt: before } },
    });
    return result.count;
  }
}
