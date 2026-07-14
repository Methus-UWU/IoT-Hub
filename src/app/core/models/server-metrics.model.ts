export type HealthLevel = 'ok' | 'warning' | 'critical';

export type ServiceState = 'running' | 'degraded' | 'stopped';

export type WebsiteState = 'up' | 'degraded' | 'down';

export type DatabaseState = 'connected' | 'degraded' | 'disconnected';

export type BackupState = 'success' | 'running' | 'failed';

export type LogLevel = 'info' | 'warn' | 'error';

export interface UsageMetric {
  usedPercent: number;
  usedBytes: number;
  totalBytes: number;
}

export interface NetworkMetric {
  inboundBytesPerSec: number;
  outboundBytesPerSec: number;
}

export interface ServiceStatus {
  name: string;
  state: ServiceState;
  uptimeSeconds: number;
}

export interface WebsiteStatus {
  name: string;
  url: string;
  state: WebsiteState;
  responseTimeMs: number;
}

export interface DatabaseStatus {
  state: DatabaseState;
  latencyMs: number;
  activeConnections: number;
}

export interface BackupStatus {
  state: BackupState;
  lastRunAt: Date;
  sizeBytes: number;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
  method: string;
  endpoint: string;
  statusCode: number;
  ip: string;
}

export interface PlatformOverview {
  totalUsers: number;
  onlineUsers: number;
  suspendedUsers: number;
  totalDevices: number;
  onlineDevices: number;
  totalProjects: number;
  totalDocuments: number;
  aiRequestsToday: number;
}

export interface DiskIoMetric {
  readBytesPerSec: number;
  writeBytesPerSec: number;
}

export interface ServerDetail {
  uptimeSeconds: number;
  loadAverage: [number, number, number];
  processCount: number;
  dockerContainersRunning: number;
  dockerContainersTotal: number;
}

export interface MetricHistoryPoint {
  capturedAt: Date;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  networkInBytesPerSec: number;
  networkOutBytesPerSec: number;
  diskReadBytesPerSec: number;
  diskWriteBytesPerSec: number;
}

export interface ServerMetricsSnapshot {
  capturedAt: Date;
  platform: PlatformOverview;
  cpu: UsageMetric;
  memory: UsageMetric;
  disk: UsageMetric;
  network: NetworkMetric;
  diskIo: DiskIoMetric;
  detail: ServerDetail;
  services: ServiceStatus[];
  websites: WebsiteStatus[];
  database: DatabaseStatus;
  backup: BackupStatus;
  logs: LogEntry[];
}
