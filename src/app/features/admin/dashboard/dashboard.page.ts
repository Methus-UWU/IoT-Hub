import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';

import { ServiceState } from '../../../core/models/server-metrics.model';
import { StatusBadge, StatusTone } from '../../../shared/components/status-badge/status-badge';
import { ICON_WRAPPER_CLASSES, MetricTone, metricTone } from '../../../shared/components/metric-card/metric-card';
import { MetricIcon, MetricIconKind } from '../../../shared/components/metric-icon/metric-icon';
import { StatCard } from '../../../shared/components/stat-card/stat-card';
import { ChartSeries, LineChart } from '../../../shared/components/line-chart/line-chart';
import { FileSizePipe } from '../../../shared/pipes/file-size.pipe';
import { UptimePipe } from '../../../shared/pipes/uptime.pipe';
import { ServerMonitoringStore } from '../server-monitoring/server-monitoring.store';

const SERVICE_TONES: Record<ServiceState, StatusTone> = {
  running: 'ok',
  degraded: 'warning',
  stopped: 'critical'
};

export type ServerMetricFilter = 'cpu' | 'memory' | 'disk' | 'network';

const METRIC_VALUE_CLASSES: Record<MetricTone, string> = {
  ok: 'text-emerald-600',
  warning: 'text-amber-600',
  critical: 'text-red-600'
};

interface MetricSummary {
  id: ServerMetricFilter;
  icon: MetricIconKind;
  label: string;
  value: string;
  caption: string;
  iconClasses: string;
  valueClasses: string;
}

const fileSize = new FileSizePipe();
const percentFormatter = (value: number): string => `${Math.round(value)}%`;
const bytesPerSecFormatter = (value: number): string => fileSize.transform(value, true);

@Component({
  selector: 'app-dashboard-page',
  imports: [MetricIcon, StatCard, LineChart, StatusBadge, UptimePipe, DatePipe, DecimalPipe],
  templateUrl: './dashboard.page.html'
})
export class DashboardPage implements OnDestroy {
  protected readonly store = inject(ServerMonitoringStore);
  protected readonly serviceTones = SERVICE_TONES;

  protected readonly selectedMetric = signal<ServerMetricFilter>('cpu');
  private readonly resourceCard = viewChild<ElementRef<HTMLElement>>('resourceCard');
  protected readonly resourceCardHeight = signal<number | null>(null);
  private resizeObserver: ResizeObserver | null = null;

  protected readonly historyLabels = computed(() =>
    this.store.history().map((point) =>
      point.capturedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    )
  );

  protected readonly chartSeries = computed<ChartSeries[]>(() => {
    const history = this.store.history();
    switch (this.selectedMetric()) {
      case 'cpu':
        return [{ name: 'CPU', color: '#4f46e5', data: history.map((p) => p.cpuPercent), format: percentFormatter }];
      case 'memory':
        return [
          { name: 'Memory', color: '#0ea5e9', data: history.map((p) => p.memoryPercent), format: percentFormatter }
        ];
      case 'disk':
        return [
          {
            name: 'Read',
            color: '#f59e0b',
            data: history.map((p) => p.diskReadBytesPerSec),
            format: bytesPerSecFormatter
          },
          {
            name: 'Write',
            color: '#0ea5e9',
            data: history.map((p) => p.diskWriteBytesPerSec),
            format: bytesPerSecFormatter
          }
        ];
      case 'network':
        return [
          {
            name: 'In',
            color: '#10b981',
            data: history.map((p) => p.networkInBytesPerSec),
            format: bytesPerSecFormatter
          },
          {
            name: 'Out',
            color: '#f59e0b',
            data: history.map((p) => p.networkOutBytesPerSec),
            format: bytesPerSecFormatter
          }
        ];
    }
  });

  protected readonly metricSummaries = computed<MetricSummary[]>(() => {
    const snapshot = this.store.snapshot();
    if (!snapshot) return [];

    const cpuTone = metricTone(snapshot.cpu.usedPercent);
    const memoryTone = metricTone(snapshot.memory.usedPercent);
    const diskTone = metricTone(snapshot.disk.usedPercent);

    return [
      {
        id: 'cpu',
        icon: 'cpu',
        label: 'CPU Usage',
        value: `${snapshot.cpu.usedPercent}%`,
        caption: '',
        iconClasses: ICON_WRAPPER_CLASSES[cpuTone],
        valueClasses: METRIC_VALUE_CLASSES[cpuTone]
      },
      {
        id: 'memory',
        icon: 'memory',
        label: 'Memory',
        value: `${snapshot.memory.usedPercent}%`,
        caption: `${fileSize.transform(snapshot.memory.usedBytes)} of ${fileSize.transform(snapshot.memory.totalBytes)}`,
        iconClasses: ICON_WRAPPER_CLASSES[memoryTone],
        valueClasses: METRIC_VALUE_CLASSES[memoryTone]
      },
      {
        id: 'disk',
        icon: 'disk',
        label: 'Storage',
        value: `${bytesPerSecFormatter(snapshot.diskIo.readBytesPerSec)} read`,
        caption: `${bytesPerSecFormatter(snapshot.diskIo.writeBytesPerSec)} write`,
        iconClasses: ICON_WRAPPER_CLASSES[diskTone],
        valueClasses: METRIC_VALUE_CLASSES[diskTone]
      },
      {
        id: 'network',
        icon: 'network',
        label: 'Network',
        value: `${bytesPerSecFormatter(snapshot.network.inboundBytesPerSec)} in`,
        caption: `${bytesPerSecFormatter(snapshot.network.outboundBytesPerSec)} out`,
        iconClasses: ICON_WRAPPER_CLASSES.ok,
        valueClasses: METRIC_VALUE_CLASSES.ok
      }
    ];
  });

  protected readonly chartMax = computed(() =>
    this.selectedMetric() === 'network' || this.selectedMetric() === 'disk' ? null : 100
  );
  protected readonly chartFormatter = computed(() =>
    this.selectedMetric() === 'network' || this.selectedMetric() === 'disk' ? bytesPerSecFormatter : percentFormatter
  );

  protected selectMetric(metric: ServerMetricFilter): void {
    this.selectedMetric.set(metric);
  }

  constructor() {
    this.store.startPolling();
    inject(DestroyRef).onDestroy(() => this.store.stopPolling());

    effect(() => {
      const element = this.resourceCard()?.nativeElement;
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.resourceCardHeight.set(null);
      if (!element) return;
      this.resizeObserver = new ResizeObserver(() => this.resourceCardHeight.set(element.getBoundingClientRect().height));
      this.resizeObserver.observe(element);
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }
}
