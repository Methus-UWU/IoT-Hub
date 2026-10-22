export type ServiceState = 'running' | 'degraded' | 'unavailable';
export type DatabaseState = 'connected' | 'disconnected';
export type LogLevel = 'info' | 'warn' | 'error';

export interface UsageMetric {
  usedPercent: number;
  usedBytes: number;
  totalBytes: number;
}

export interface ServiceStatus {
  name: string;
  state: ServiceState;
  detail: string;
  uptimeSeconds?: number;
}

export interface DatabaseStatus {
  state: DatabaseState;
  latencyMs: number | null;
  activeConnections: number | null;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
  method: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  requestId: string;
}

export interface PlatformOverview {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  totalProjects: number;
  totalProjectFiles: number;
  totalCommunityPosts: number;
}

export interface ServerDetail {
  uptimeSeconds: number;
  loadAverage: number[];
  processId: number;
}

export interface RequestSummary {
  total: number;
  errors: number;
  averageDurationMs: number;
  windowMinutes: number;
}

export interface MetricHistoryPoint {
  capturedAt: Date;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number | null;
}

export interface ServerMetricsSnapshot {
  capturedAt: Date;
  platform: PlatformOverview | null;
  cpu: UsageMetric;
  memory: UsageMetric;
  disk: UsageMetric | null;
  detail: ServerDetail;
  services: ServiceStatus[];
  database: DatabaseStatus;
  requests: RequestSummary;
  logs: LogEntry[];
}
