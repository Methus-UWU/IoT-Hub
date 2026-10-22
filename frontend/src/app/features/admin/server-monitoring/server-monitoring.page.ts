import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject } from '@angular/core';

import { ServiceState } from '../../../core/models/server-metrics.model';
import { ChartSeries, LineChart } from '../../../shared/components/line-chart/line-chart';
import { StatusBadge, StatusTone } from '../../../shared/components/status-badge/status-badge';
import { FileSizePipe } from '../../../shared/pipes/file-size.pipe';
import { UptimePipe } from '../../../shared/pipes/uptime.pipe';
import { ServerMonitoringStore } from './server-monitoring.store';

const SERVICE_TONES: Record<ServiceState, StatusTone> = {
  running: 'ok',
  degraded: 'warning',
  unavailable: 'critical',
};

@Component({
  selector: 'app-server-monitoring-page',
  imports: [DatePipe, LineChart, StatusBadge, FileSizePipe, UptimePipe],
  templateUrl: './server-monitoring.page.html',
  styleUrl: './server-monitoring.page.css',
})
export class ServerMonitoringPage {
  protected readonly store = inject(ServerMonitoringStore);
  protected readonly serviceTones = SERVICE_TONES;

  protected readonly historyLabels = computed(() =>
    this.store.history().map((point) =>
      point.capturedAt.toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    ),
  );

  protected readonly resourceSeries = computed<ChartSeries[]>(() => [
    {
      name: 'CPU ของ API',
      color: '#2B2B2B',
      data: this.store.history().map((point) => point.cpuPercent),
      format: (value) => `${Math.round(value)}%`,
    },
    {
      name: 'หน่วยความจำของ API',
      color: '#7c3aed',
      data: this.store.history().map((point) => point.memoryPercent),
      format: (value) => `${Math.round(value)}%`,
    },
  ]);

  constructor() {
    this.store.startPolling();
    inject(DestroyRef).onDestroy(() => this.store.stopPolling());
  }

  protected serviceStateLabel(state: ServiceState): string {
    return {
      running: 'ทำงานปกติ',
      degraded: 'ประสิทธิภาพลดลง',
      unavailable: 'ไม่พร้อมใช้งาน',
    }[state];
  }

  protected usageTone(percent: number): string {
    if (percent >= 90) return 'bg-red-500';
    if (percent >= 75) return 'bg-amber-500';
    return 'bg-emerald-500';
  }
}
