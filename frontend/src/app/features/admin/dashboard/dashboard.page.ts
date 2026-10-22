import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ChartSeries, LineChart } from '../../../shared/components/line-chart/line-chart';
import { FileSizePipe } from '../../../shared/pipes/file-size.pipe';
import { UptimePipe } from '../../../shared/pipes/uptime.pipe';
import { ServerMonitoringStore } from '../server-monitoring/server-monitoring.store';

@Component({
  selector: 'app-dashboard-page',
  imports: [DatePipe, DecimalPipe, RouterLink, LineChart, FileSizePipe, UptimePipe],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.css',
})
export class DashboardPage {
  protected readonly store = inject(ServerMonitoringStore);

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
      color: '#7c3aed',
      data: this.store.history().map((point) => point.cpuPercent),
      format: (value) => `${Math.round(value)}%`,
    },
    {
      name: 'หน่วยความจำของ API',
      color: '#0891b2',
      data: this.store.history().map((point) => point.memoryPercent),
      format: (value) => `${Math.round(value)}%`,
    },
  ]);

  protected readonly issueCount = computed(() => {
    const snapshot = this.store.snapshot();
    if (!snapshot) return 0;
    return (
      snapshot.services.filter((service) => service.state !== 'running').length +
      (snapshot.cpu.usedPercent >= 90 ? 1 : 0) +
      (snapshot.memory.usedPercent >= 90 ? 1 : 0) +
      ((snapshot.disk?.usedPercent ?? 0) >= 90 ? 1 : 0)
    );
  });

  constructor() {
    this.store.startPolling();
    inject(DestroyRef).onDestroy(() => this.store.stopPolling());
  }
}
