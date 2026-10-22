import { HttpClient, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { WorkspaceContextService } from '../../../../core/services/workspace-context.service';

export type TelemetryValue = number | boolean | string;
export type TelemetryRange = '1h' | '24h' | '7d' | '30d';

export interface DeviceView {
  id: string;
  name: string;
  tokenHint: string;
  lastSeenAt: string | null;
  online: boolean;
  createdAt: string;
}

export interface DeviceWithToken {
  device: DeviceView;
  /** Shown once; the server keeps only its hash. */
  token: string;
}

export interface DeviceSnapshot {
  deviceId: string;
  online: boolean;
  lastSeenAt: string | null;
  values: Record<string, { value: TelemetryValue; source: 'device' | 'app'; updatedAt: string }>;
}

export interface DeviceSeries {
  key: string;
  range: TelemetryRange;
  points: { at: string; value: number }[];
}

/** A project's devices and their telemetry. The server authorizes every call. */
@Service()
export class DevicesApiClient {
  private readonly http = inject(HttpClient);
  private readonly workspaces = inject(WorkspaceContextService);

  async list(projectId: string): Promise<DeviceView[]> {
    return firstValueFrom(this.http.get<DeviceView[]>(await this.url(projectId)));
  }

  async create(projectId: string, name: string): Promise<DeviceWithToken> {
    return firstValueFrom(this.http.post<DeviceWithToken>(await this.url(projectId), { name }));
  }

  async rename(projectId: string, deviceId: string, name: string): Promise<DeviceView> {
    return firstValueFrom(
      this.http.patch<DeviceView>(await this.url(projectId, deviceId), { name }),
    );
  }

  async rotateToken(projectId: string, deviceId: string): Promise<DeviceWithToken> {
    return firstValueFrom(
      this.http.post<DeviceWithToken>(`${await this.url(projectId, deviceId)}/token`, {}),
    );
  }

  async remove(projectId: string, deviceId: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(await this.url(projectId, deviceId)));
  }

  async snapshot(projectId: string, deviceId: string): Promise<DeviceSnapshot> {
    return firstValueFrom(
      this.http.get<DeviceSnapshot>(`${await this.url(projectId, deviceId)}/values`),
    );
  }

  async series(
    projectId: string,
    deviceId: string,
    key: string,
    range: TelemetryRange,
  ): Promise<DeviceSeries> {
    const params = new HttpParams().set('key', key).set('range', range);
    return firstValueFrom(
      this.http.get<DeviceSeries>(`${await this.url(projectId, deviceId)}/series`, { params }),
    );
  }

  async setControl(
    projectId: string,
    deviceId: string,
    key: string,
    value: TelemetryValue,
  ): Promise<void> {
    await firstValueFrom(
      this.http.put<void>(
        `${await this.url(projectId, deviceId)}/values/${encodeURIComponent(key)}`,
        { value },
      ),
    );
  }

  private async url(projectId: string, deviceId?: string): Promise<string> {
    const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
    if (!workspace) throw new Error('No workspace is available for this account');
    const base = `${environment.apiUrl}workspaces/${encodeURIComponent(
      workspace.id,
    )}/projects/${encodeURIComponent(projectId)}/devices`;
    return deviceId ? `${base}/${encodeURIComponent(deviceId)}` : base;
  }
}
