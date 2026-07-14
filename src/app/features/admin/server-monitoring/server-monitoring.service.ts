import { Injectable } from '@angular/core';
import { Observable, interval, map, startWith } from 'rxjs';

import {
  LogEntry,
  PlatformOverview,
  ServerDetail,
  ServerMetricsSnapshot,
  ServiceStatus,
  WebsiteStatus
} from '../../../core/models/server-metrics.model';

const POLL_INTERVAL_MS = 5000;
const TOTAL_MEMORY_BYTES = 16 * 1024 ** 3;
const TOTAL_DISK_BYTES = 512 * 1024 ** 3;
const MAX_LOG_ENTRIES = 10;

const SERVICE_NAMES = [
  'Angular Web',
  'NestJS API',
  'Supabase Database',
  'Supabase Auth',
  'Supabase Storage',
  'Redis',
  'Redis Queue',
  'MQTT Broker',
  'WebSocket Gateway',
  'AI Service',
  'Deploy Worker',
  'Backup Worker',
  'Email Service'
];
const WEBSITE_TARGETS: Array<{ name: string; url: string }> = [
  { name: 'Marketing Site', url: 'https://iot-hub.example.com' },
  { name: 'Admin Console', url: 'https://admin.iot-hub.example.com' },
  { name: 'Public API', url: 'https://api.iot-hub.example.com' }
];

const REQUEST_ENDPOINTS: Array<{ method: string; endpoint: string }> = [
  { method: 'GET', endpoint: '/api/devices' },
  { method: 'GET', endpoint: '/api/projects' },
  { method: 'POST', endpoint: '/api/devices/telemetry' },
  { method: 'POST', endpoint: '/api/auth/login' },
  { method: 'GET', endpoint: '/api/documents' },
  { method: 'POST', endpoint: '/api/deploy' },
  { method: 'GET', endpoint: '/api/admin/users' },
  { method: 'POST', endpoint: '/api/ai/generate' }
];

const SAMPLE_IPS = [
  '203.0.113.14',
  '198.51.100.42',
  '192.0.2.77',
  '203.0.113.201',
  '198.51.100.9',
  '192.0.2.150'
];

@Injectable({ providedIn: 'root' })
export class ServerMonitoringService {
  private previousCpuPercent = 32;
  private previousMemoryPercent = 54;
  private previousDiskPercent = 61;
  private logIdSeed = 0;
  private logs: LogEntry[] = [];

  private readonly totalUsers = 1284;
  private readonly suspendedUsers = 18;
  private readonly totalDevices = 3420;
  private readonly totalProjects = 214;
  private readonly totalDocuments = 5821;
  private previousOnlineUsers = 96;
  private previousOnlineDevices = 812;
  private previousAiRequestsToday = 640;
  private previousLoad1m = 1.2;

  watchMetrics(): Observable<ServerMetricsSnapshot> {
    return interval(POLL_INTERVAL_MS).pipe(
      startWith(0),
      map(() => this.generateSnapshot())
    );
  }

  private generateSnapshot(): ServerMetricsSnapshot {
    this.previousCpuPercent = this.drift(this.previousCpuPercent, 15, 5, 97);
    this.previousMemoryPercent = this.drift(this.previousMemoryPercent, 6, 20, 95);
    this.previousDiskPercent = this.drift(this.previousDiskPercent, 2, 30, 92);

    const services = SERVICE_NAMES.map((name) => this.generateServiceStatus(name));
    const websites = WEBSITE_TARGETS.map((target) => this.generateWebsiteStatus(target));
    const database = {
      state: (Math.random() > 0.05 ? 'connected' : 'degraded') as ServerMetricsSnapshot['database']['state'],
      latencyMs: this.randomBetween(4, 60),
      activeConnections: this.randomBetween(8, 120)
    };

    this.appendLogEntries(services, websites, database.state);

    return {
      capturedAt: new Date(),
      platform: this.generatePlatformOverview(),
      cpu: {
        usedPercent: this.previousCpuPercent,
        usedBytes: 0,
        totalBytes: 0
      },
      memory: {
        usedPercent: this.previousMemoryPercent,
        usedBytes: Math.round((this.previousMemoryPercent / 100) * TOTAL_MEMORY_BYTES),
        totalBytes: TOTAL_MEMORY_BYTES
      },
      disk: {
        usedPercent: this.previousDiskPercent,
        usedBytes: Math.round((this.previousDiskPercent / 100) * TOTAL_DISK_BYTES),
        totalBytes: TOTAL_DISK_BYTES
      },
      network: {
        inboundBytesPerSec: this.randomBetween(200_000, 4_500_000),
        outboundBytesPerSec: this.randomBetween(100_000, 2_500_000)
      },
      diskIo: {
        readBytesPerSec: this.randomBetween(500_000, 12_000_000),
        writeBytesPerSec: this.randomBetween(200_000, 6_000_000)
      },
      detail: this.generateServerDetail(),
      services,
      websites,
      database,
      backup: {
        state: 'success',
        lastRunAt: new Date(Date.now() - this.randomBetween(1, 10) * 60 * 60 * 1000),
        sizeBytes: this.randomBetween(1.5 * 1024 ** 3, 3.2 * 1024 ** 3)
      },
      logs: this.logs
    };
  }

  private generatePlatformOverview(): PlatformOverview {
    this.previousOnlineUsers = this.drift(this.previousOnlineUsers, 6, 20, Math.round(this.totalUsers * 0.35));
    this.previousOnlineDevices = this.drift(this.previousOnlineDevices, 40, 350, Math.round(this.totalDevices * 0.6));
    this.previousAiRequestsToday = this.drift(this.previousAiRequestsToday, 15, 0, 5000);

    return {
      totalUsers: this.totalUsers,
      onlineUsers: this.previousOnlineUsers,
      suspendedUsers: this.suspendedUsers,
      totalDevices: this.totalDevices,
      onlineDevices: this.previousOnlineDevices,
      totalProjects: this.totalProjects,
      totalDocuments: this.totalDocuments,
      aiRequestsToday: this.previousAiRequestsToday
    };
  }

  private generateServerDetail(): ServerDetail {
    this.previousLoad1m = Math.max(0.1, this.previousLoad1m + (Math.random() - 0.5) * 0.3);

    return {
      uptimeSeconds: 26 * 86400 + this.randomBetween(0, 86400),
      loadAverage: [
        Number(this.previousLoad1m.toFixed(2)),
        Number((this.previousLoad1m * 1.1).toFixed(2)),
        Number((this.previousLoad1m * 1.2).toFixed(2))
      ],
      processCount: this.randomBetween(180, 260),
      dockerContainersRunning: this.randomBetween(10, 14),
      dockerContainersTotal: 14
    };
  }

  private generateServiceStatus(name: string): ServiceStatus {
    const isHealthy = Math.random() > 0.08;
    return {
      name,
      state: isHealthy ? 'running' : Math.random() > 0.5 ? 'degraded' : 'stopped',
      uptimeSeconds: isHealthy ? this.randomBetween(3600, 30 * 86400) : 0
    };
  }

  private generateWebsiteStatus(target: { name: string; url: string }): WebsiteStatus {
    const isUp = Math.random() > 0.06;
    return {
      name: target.name,
      url: target.url,
      state: isUp ? 'up' : Math.random() > 0.5 ? 'degraded' : 'down',
      responseTimeMs: isUp ? this.randomBetween(40, 320) : 0
    };
  }

  private appendLogEntries(
    services: ServiceStatus[],
    websites: WebsiteStatus[],
    databaseState: ServerMetricsSnapshot['database']['state']
  ): void {
    const newEntries: LogEntry[] = [];
    const requestCount = this.randomBetween(1, 3);

    for (let i = 0; i < requestCount; i++) {
      newEntries.push(this.createRequestLogEntry());
    }

    for (const service of services) {
      if (service.state !== 'running') {
        newEntries.push(
          this.createLogEntry('error', `Service "${service.name}" is ${service.state}`, 'GET', '/internal/health', 503)
        );
      }
    }

    for (const website of websites) {
      if (website.state !== 'up') {
        newEntries.push(this.createLogEntry('warn', `Website "${website.name}" health check failed`, 'GET', '/', 502));
      }
    }

    if (databaseState !== 'connected') {
      newEntries.push(this.createLogEntry('error', 'Database connection degraded', 'GET', '/internal/db-ping', 500));
    }

    this.logs = [...newEntries, ...this.logs].slice(0, MAX_LOG_ENTRIES);
  }

  private createRequestLogEntry(): LogEntry {
    const { method, endpoint } = REQUEST_ENDPOINTS[this.randomBetween(0, REQUEST_ENDPOINTS.length - 1)];
    const isError = Math.random() < 0.12;
    const statusCode = isError ? (Math.random() > 0.5 ? 500 : 404) : method === 'POST' ? 201 : 200;
    const level = isError ? 'error' : 'info';
    const message = isError ? `Request failed: ${method} ${endpoint}` : `${method} ${endpoint} handled successfully`;

    return this.createLogEntry(level, message, method, endpoint, statusCode);
  }

  private createLogEntry(
    level: LogEntry['level'],
    message: string,
    method: string,
    endpoint: string,
    statusCode: number
  ): LogEntry {
    this.logIdSeed += 1;
    return {
      id: `log-${this.logIdSeed}`,
      timestamp: new Date(),
      level,
      message,
      method,
      endpoint,
      statusCode,
      ip: SAMPLE_IPS[this.randomBetween(0, SAMPLE_IPS.length - 1)]
    };
  }

  private drift(current: number, maxDelta: number, min: number, max: number): number {
    const delta = this.randomBetween(-maxDelta, maxDelta);
    return Math.min(max, Math.max(min, Math.round(current + delta)));
  }

  private randomBetween(min: number, max: number): number {
    return Math.round(Math.random() * (max - min) + min);
  }
}
