import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';

import { LogLevel } from '../../../core/models/server-metrics.model';
import { StatusBadge, StatusTone } from '../../../shared/components/status-badge/status-badge';
import { ServerMonitoringStore } from '../server-monitoring/server-monitoring.store';

const LOG_TONES: Record<LogLevel, StatusTone> = {
  info: 'neutral',
  warn: 'warning',
  error: 'critical',
};

type LevelFilter = LogLevel | 'all';

@Component({
  selector: 'app-system-logs-page',
  imports: [StatusBadge, DatePipe],
  templateUrl: './system-logs.page.html',
})
export class SystemLogsPage {
  protected readonly store = inject(ServerMonitoringStore);
  protected readonly logTones = LOG_TONES;

  private readonly _levelFilter = signal<LevelFilter>('all');
  protected readonly levelFilter = this._levelFilter.asReadonly();

  protected readonly filters: Array<{ value: LevelFilter; label: string }> = [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'info', label: 'ข้อมูล' },
    { value: 'warn', label: 'คำเตือน' },
    { value: 'error', label: 'ข้อผิดพลาด' },
  ];

  protected readonly filteredLogs = computed(() => {
    const level = this._levelFilter();
    const logs = this.store.logs();
    return level === 'all' ? logs : logs.filter((log) => log.level === level);
  });

  constructor() {
    this.store.startPolling();
    inject(DestroyRef).onDestroy(() => this.store.stopPolling());
  }

  protected setLevelFilter(level: LevelFilter): void {
    this._levelFilter.set(level);
  }
}
