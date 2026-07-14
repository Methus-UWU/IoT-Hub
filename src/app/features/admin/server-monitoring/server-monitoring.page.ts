import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject } from '@angular/core';

import {
  DatabaseState,
  ServiceState,
  BackupState,
  WebsiteState
} from '../../../core/models/server-metrics.model';
import { StatusTone, StatusBadge } from '../../../shared/components/status-badge/status-badge';
import { MetricCard } from '../../../shared/components/metric-card/metric-card';
import { LineChart, ChartSeries } from '../../../shared/components/line-chart/line-chart';
import { FileSizePipe } from '../../../shared/pipes/file-size.pipe';
import { UptimePipe } from '../../../shared/pipes/uptime.pipe';
import { ServerMonitoringStore } from './server-monitoring.store';

const SERVICE_TONES: Record<ServiceState, StatusTone> = {
  running: 'ok',
  degraded: 'warning',
  stopped: 'critical'
};

const WEBSITE_TONES: Record<WebsiteState, StatusTone> = {
  up: 'ok',
  degraded: 'warning',
  down: 'critical'
};

const DATABASE_TONES: Record<DatabaseState, StatusTone> = {
  connected: 'ok',
  degraded: 'warning',
  disconnected: 'critical'
};

const BACKUP_TONES: Record<BackupState, StatusTone> = {
  success: 'ok',
  running: 'neutral',
  failed: 'critical'
};

const fileSize = new FileSizePipe();
const percentFormatter = (value: number): string => `${Math.round(value)}%`;
const bytesPerSecFormatter = (value: number): string => fileSize.transform(value, true);

@Component({
  selector: 'app-server-monitoring-page',
  imports: [MetricCard, LineChart, StatusBadge, FileSizePipe, UptimePipe, DatePipe],
  templateUrl: './server-monitoring.page.html',
  styleUrl: './server-monitoring.page.css'
})
export class ServerMonitoringPage {
  protected readonly store = inject(ServerMonitoringStore);

  protected readonly serviceTones = SERVICE_TONES;
  protected readonly websiteTones = WEBSITE_TONES;
  protected readonly databaseTones = DATABASE_TONES;
  protected readonly backupTones = BACKUP_TONES;

  protected readonly percentFormatter = percentFormatter;
  protected readonly bytesPerSecFormatter = bytesPerSecFormatter;

  protected readonly historyLabels = computed(() =>
    this.store.history().map((point) =>
      point.capturedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    )
  );

  protected readonly cpuSeries = computed<ChartSeries[]>(() => [
    { name: 'CPU', color: '#4f46e5', data: this.store.history().map((point) => point.cpuPercent) }
  ]);

  protected readonly memorySeries = computed<ChartSeries[]>(() => [
    { name: 'Memory', color: '#0ea5e9', data: this.store.history().map((point) => point.memoryPercent) }
  ]);

  protected readonly networkSeries = computed<ChartSeries[]>(() => [
    { name: 'In', color: '#10b981', data: this.store.history().map((point) => point.networkInBytesPerSec) },
    { name: 'Out', color: '#f59e0b', data: this.store.history().map((point) => point.networkOutBytesPerSec) }
  ]);

  protected readonly diskIoSeries = computed<ChartSeries[]>(() => [
    { name: 'Read', color: '#8b5cf6', data: this.store.history().map((point) => point.diskReadBytesPerSec) },
    { name: 'Write', color: '#ec4899', data: this.store.history().map((point) => point.diskWriteBytesPerSec) }
  ]);

  constructor() {
    this.store.startPolling();
    inject(DestroyRef).onDestroy(() => this.store.stopPolling());
  }
}
