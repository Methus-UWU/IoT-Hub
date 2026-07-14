import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { MetricHistoryPoint, ServerMetricsSnapshot } from '../../../core/models/server-metrics.model';
import { LoggerService } from '../../../core/services/logger.service';
import { ServerMonitoringService } from './server-monitoring.service';

const MAX_HISTORY_POINTS = 30;

@Injectable({ providedIn: 'root' })
export class ServerMonitoringStore {
  private readonly monitoringService = inject(ServerMonitoringService);
  private readonly logger = inject(LoggerService);

  private readonly warnedKeys = new Set<string>();
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
  readonly cpu = computed(() => this._snapshot()?.cpu ?? null);
  readonly memory = computed(() => this._snapshot()?.memory ?? null);
  readonly disk = computed(() => this._snapshot()?.disk ?? null);
  readonly network = computed(() => this._snapshot()?.network ?? null);
  readonly diskIo = computed(() => this._snapshot()?.diskIo ?? null);
  readonly detail = computed(() => this._snapshot()?.detail ?? null);
  readonly services = computed(() => this._snapshot()?.services ?? []);
  readonly websites = computed(() => this._snapshot()?.websites ?? []);
  readonly database = computed(() => this._snapshot()?.database ?? null);
  readonly backup = computed(() => this._snapshot()?.backup ?? null);
  readonly logs = computed(() => this._snapshot()?.logs ?? []);
  readonly lastUpdated = computed(() => this._snapshot()?.capturedAt ?? null);

  startPolling(): void {
    if (this.subscription) {
      return;
    }

    this._loading.set(true);
    this.subscription = this.monitoringService.watchMetrics().subscribe({
      next: (snapshot) => {
        this._snapshot.set(snapshot);
        this._loading.set(false);
        this._error.set(null);
        this.appendHistory(snapshot);
        this.checkForAlerts(snapshot);
      },
      error: (err) => {
        this._error.set('Unable to load server metrics.');
        this._loading.set(false);
        this.logger.error('Server monitoring stream failed', err);
      }
    });
  }

  private appendHistory(snapshot: ServerMetricsSnapshot): void {
    const point: MetricHistoryPoint = {
      capturedAt: snapshot.capturedAt,
      cpuPercent: snapshot.cpu.usedPercent,
      memoryPercent: snapshot.memory.usedPercent,
      diskPercent: snapshot.disk.usedPercent,
      networkInBytesPerSec: snapshot.network.inboundBytesPerSec,
      networkOutBytesPerSec: snapshot.network.outboundBytesPerSec,
      diskReadBytesPerSec: snapshot.diskIo.readBytesPerSec,
      diskWriteBytesPerSec: snapshot.diskIo.writeBytesPerSec
    };
    this._history.update((points) => [...points, point].slice(-MAX_HISTORY_POINTS));
  }

  stopPolling(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  private checkForAlerts(snapshot: ServerMetricsSnapshot): void {
    this.raiseOrClear('cpu', snapshot.cpu.usedPercent >= 90, () =>
      this.logger.warn('Server CPU usage is high', { percent: snapshot.cpu.usedPercent })
    );

    this.raiseOrClear('database', snapshot.database.state !== 'connected', () =>
      this.logger.error('Database connection degraded', snapshot.database)
    );

    this.raiseOrClear('backup', snapshot.backup.state === 'failed', () =>
      this.logger.error('Database backup failed', snapshot.backup)
    );

    for (const service of snapshot.services) {
      this.raiseOrClear(`service:${service.name}`, service.state !== 'running', () =>
        this.logger.warn(`Service "${service.name}" is ${service.state}`, service)
      );
    }

    for (const website of snapshot.websites) {
      this.raiseOrClear(`website:${website.name}`, website.state !== 'up', () =>
        this.logger.warn(`Website "${website.name}" is ${website.state}`, website)
      );
    }
  }

  private raiseOrClear(key: string, isUnhealthy: boolean, logOnce: () => void): void {
    if (isUnhealthy) {
      if (!this.warnedKeys.has(key)) {
        this.warnedKeys.add(key);
        logOnce();
      }
    } else {
      this.warnedKeys.delete(key);
    }
  }
}
