import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { ServerMetricsSnapshot } from '../../../core/models/server-metrics.model';
import { environment } from '../../../../environments/environment';

interface ServerMetricsResponse extends Omit<ServerMetricsSnapshot, 'capturedAt' | 'logs'> {
  capturedAt: string;
  logs: Array<Omit<ServerMetricsSnapshot['logs'][number], 'timestamp'> & { timestamp: string }>;
}

@Injectable({ providedIn: 'root' })
export class ServerMonitoringService {
  private readonly http = inject(HttpClient);

  getSnapshot(): Observable<ServerMetricsSnapshot> {
    return this.http
      .get<ServerMetricsResponse>(`${environment.apiUrl}admin/monitoring/snapshot`)
      .pipe(
        map((snapshot) => ({
          ...snapshot,
          capturedAt: new Date(snapshot.capturedAt),
          logs: snapshot.logs.map((entry) => ({
            ...entry,
            timestamp: new Date(entry.timestamp),
          })),
        })),
      );
  }
}
