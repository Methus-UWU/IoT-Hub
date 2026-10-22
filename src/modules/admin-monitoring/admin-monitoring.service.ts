import { Injectable } from '@nestjs/common';
import { loadavg, totalmem } from 'node:os';
import { statfsSync } from 'node:fs';

import {
  AdminRequestLogStore,
  type AdminRequestLogEntry,
  type AdminRequestSummary,
} from './admin-request-log.store';
import {
  AdminMonitoringRepository,
  type AdminDatabaseHealth,
  type AdminPlatformCounts,
} from './admin-monitoring.repository';

export interface UsageMetric {
  usedPercent: number;
  usedBytes: number;
  totalBytes: number;
}

export interface AdminMonitoringSnapshot {
  capturedAt: string;
  platform: AdminPlatformCounts | null;
  cpu: UsageMetric;
  memory: UsageMetric;
  disk: UsageMetric | null;
  detail: {
    uptimeSeconds: number;
    loadAverage: number[];
    processId: number;
  };
  database: {
    state: 'connected' | 'disconnected';
    latencyMs: number | null;
    activeConnections: number | null;
  };
  services: Array<{
    name: string;
    state: 'running' | 'unavailable';
    detail: string;
    uptimeSeconds?: number;
  }>;
  requests: AdminRequestSummary;
  logs: AdminRequestLogEntry[];
}

@Injectable()
export class AdminMonitoringService {
  private previousCpuUsage = process.cpuUsage();
  private previousCpuSampleAt = performance.now();

  constructor(
    private readonly repository: AdminMonitoringRepository,
    private readonly logs: AdminRequestLogStore,
  ) {}

  async getSnapshot(): Promise<AdminMonitoringSnapshot> {
    const [platform, database] = await Promise.all([
      this.readPlatformCounts(),
      this.readDatabaseHealth(),
    ]);

    const memory = this.readMemory();
    return {
      capturedAt: new Date().toISOString(),
      platform,
      cpu: {
        usedPercent: this.readCpuPercent(),
        usedBytes: 0,
        totalBytes: 0,
      },
      memory,
      disk: this.readDisk(),
      detail: {
        uptimeSeconds: Math.round(process.uptime()),
        loadAverage: loadavg().map((value) => Number(value.toFixed(2))),
        processId: process.pid,
      },
      database: database
        ? {
            state: 'connected' as const,
            latencyMs: database.latencyMs,
            activeConnections: database.activeConnections,
          }
        : {
            state: 'disconnected' as const,
            latencyMs: null,
            activeConnections: null,
          },
      services: [
        {
          name: 'NestJS API',
          state: 'running' as const,
          detail: 'กระบวนการ API กำลังตอบสนอง',
          uptimeSeconds: Math.round(process.uptime()),
        },
        {
          name: 'PostgreSQL',
          state: database ? ('running' as const) : ('unavailable' as const),
          detail: database
            ? `ตอบสนองใน ${database.latencyMs} ms`
            : 'ไม่สามารถอ่านสถานะฐานข้อมูลได้',
        },
      ],
      requests: this.logs.summary(),
      logs: this.logs.recent(),
    };
  }

  private async readPlatformCounts(): Promise<AdminPlatformCounts | null> {
    try {
      return await this.repository.readPlatformCounts();
    } catch {
      return null;
    }
  }

  private async readDatabaseHealth(): Promise<AdminDatabaseHealth | null> {
    try {
      return await this.repository.readDatabaseHealth();
    } catch {
      return null;
    }
  }

  private readCpuPercent(): number {
    const current = process.cpuUsage();
    const sampledAt = performance.now();
    const elapsedMicros = Math.max(
      1,
      (sampledAt - this.previousCpuSampleAt) * 1000,
    );
    const usedMicros =
      current.user -
      this.previousCpuUsage.user +
      current.system -
      this.previousCpuUsage.system;
    this.previousCpuUsage = current;
    this.previousCpuSampleAt = sampledAt;
    return Number(
      Math.min(100, Math.max(0, (usedMicros / elapsedMicros) * 100)).toFixed(1),
    );
  }

  private readMemory(): UsageMetric {
    const usedBytes = process.memoryUsage().rss;
    const constrainedBytes = process.constrainedMemory?.() ?? 0;
    const totalBytes = constrainedBytes > 0 ? constrainedBytes : totalmem();
    return {
      usedBytes,
      totalBytes,
      usedPercent: Number(
        Math.min(100, (usedBytes / totalBytes) * 100).toFixed(1),
      ),
    };
  }

  private readDisk(): UsageMetric | null {
    try {
      const disk = statfsSync(process.cwd());
      const totalBytes = Number(disk.bsize) * Number(disk.blocks);
      const availableBytes = Number(disk.bsize) * Number(disk.bavail);
      const usedBytes = Math.max(0, totalBytes - availableBytes);
      return {
        usedBytes,
        totalBytes,
        usedPercent: totalBytes
          ? Number(((usedBytes / totalBytes) * 100).toFixed(1))
          : 0,
      };
    } catch {
      return null;
    }
  }
}
