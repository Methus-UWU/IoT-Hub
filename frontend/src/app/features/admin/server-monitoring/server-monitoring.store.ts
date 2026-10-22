import { Injectable, computed, inject, signal } from '@angular/core';
import { EMPTY, Subscription, catchError, exhaustMap, timer } from 'rxjs';

import {
  MetricHistoryPoint,
  ServerMetricsSnapshot,
} from '../../../core/models/server-metrics.model';
import { LoggerService } from '../../../core/services/logger.service';
import { ServerMonitoringService } from './server-monitoring.service';

const MAX_HISTORY_POINTS = 30;
const POLL_INTERVAL_MS = 5000;

@Injectable({ providedIn: 'root' })
export class ServerMonitoringStore {
  private readonly monitoringService = inject(ServerMonitoringService);
  private readonly logger = inject(LoggerService);
  private subscription: Subscription | null = null;

  private readonly _snapshot = signal<ServerMetricsSnapshot | null>(null);
  private readonly _history = signal<MetricHistoryPoint[]>([]);
  private readonly _loading = signal(true);
  private readonly _error = signal<string | null>(null);

  readonly snapshot = this._snapshot.asReadonly();
  readonly history = this._history.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly platform = computed(() => this._snapshot()?.platform ?? null);
  readonly services = computed(() => this._snapshot()?.services ?? []);
  readonly logs = computed(() => this._snapshot()?.logs ?? []);
  readonly lastUpdated = computed(() => this._snapshot()?.capturedAt ?? null);

  startPolling(): void {
    if (this.subscription) return;

    this._loading.set(true);
    this.subscription = timer(0, POLL_INTERVAL_MS)
      .pipe(
        exhaustMap(() =>
          this.monitoringService.getSnapshot().pipe(
            catchError((error: unknown) => {
              this._error.set('ไม่สามารถโหลดข้อมูลสถานะระบบได้');
              this._loading.set(false);
              this.logger.error('Admin monitoring request failed', error);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe((snapshot) => {
        this._snapshot.set(snapshot);
        this._loading.set(false);
        this._error.set(null);
        this.appendHistory(snapshot);
      });
  }

  stopPolling(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  retry(): void {
    this.stopPolling();
    this.startPolling();
  }

  dismissError(): void {
    this._error.set(null);
  }

  private appendHistory(snapshot: ServerMetricsSnapshot): void {
    const point: MetricHistoryPoint = {
      capturedAt: snapshot.capturedAt,
      cpuPercent: snapshot.cpu.usedPercent,
      memoryPercent: snapshot.memory.usedPercent,
      diskPercent: snapshot.disk?.usedPercent ?? null,
    };
    this._history.update((points) => [...points, point].slice(-MAX_HISTORY_POINTS));
  }
}
