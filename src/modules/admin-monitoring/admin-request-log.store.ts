import { Injectable } from '@nestjs/common';

export type AdminRequestLogLevel = 'info' | 'warn' | 'error';

export interface AdminRequestLogEntry {
  id: string;
  timestamp: Date;
  level: AdminRequestLogLevel;
  message: string;
  method: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  requestId: string;
}

export interface AdminRequestSummary {
  total: number;
  errors: number;
  averageDurationMs: number;
  windowMinutes: number;
}

const MAX_ENTRIES = 200;
const SUMMARY_WINDOW_MINUTES = 5;

/**
 * A bounded view of requests handled by this API process.
 *
 * It deliberately stores no headers, query strings, bodies, tokens, or client IPs.
 * The buffer is operational telemetry, not an audit trail, and resets on deploy.
 */
@Injectable()
export class AdminRequestLogStore {
  private entries: AdminRequestLogEntry[] = [];
  private sequence = 0;

  record(
    entry: Omit<AdminRequestLogEntry, 'id' | 'timestamp' | 'level' | 'message'>,
  ): void {
    this.sequence += 1;
    const level = this.levelFor(entry.statusCode);
    const stored: AdminRequestLogEntry = {
      ...entry,
      id: `${Date.now()}-${this.sequence}`,
      timestamp: new Date(),
      level,
      message: `${entry.method} ${entry.endpoint} completed with ${entry.statusCode}`,
    };
    this.entries = [stored, ...this.entries].slice(0, MAX_ENTRIES);
  }

  recent(limit = 100): AdminRequestLogEntry[] {
    return this.entries.slice(0, Math.max(0, Math.min(limit, MAX_ENTRIES)));
  }

  summary(now = Date.now()): AdminRequestSummary {
    const cutoff = now - SUMMARY_WINDOW_MINUTES * 60_000;
    const recent = this.entries.filter(
      (entry) => entry.timestamp.getTime() >= cutoff,
    );
    const totalDuration = recent.reduce(
      (sum, entry) => sum + entry.durationMs,
      0,
    );
    return {
      total: recent.length,
      errors: recent.filter((entry) => entry.statusCode >= 500).length,
      averageDurationMs: recent.length
        ? Math.round(totalDuration / recent.length)
        : 0,
      windowMinutes: SUMMARY_WINDOW_MINUTES,
    };
  }

  private levelFor(statusCode: number): AdminRequestLogLevel {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }
}
