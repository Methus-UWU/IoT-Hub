import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';

export interface RemoteWorkspaceFile {
  path: string;
  content: string;
  size: number;
  updatedAt: string;
}

export interface WorkspaceBuildResult {
  target: 'build' | 'upload';
  success: true;
  output: string;
  durationMs: number;
}

export interface WorkspaceToolchainStatus {
  available: boolean;
  command: string;
  version: string | null;
}

export interface WorkspaceDevice {
  port: string;
  description: string;
  hardwareId: string | null;
}

export interface WorkspaceDeviceList {
  available: boolean;
  devices: WorkspaceDevice[];
  message: string | null;
}

export interface SerialMonitorLine {
  id: number;
  timestamp: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface SerialMonitorOutput {
  running: boolean;
  port: string | null;
  baud: number | null;
  exitCode: number | null;
  cursor: number;
  lines: SerialMonitorLine[];
}

@Injectable({ providedIn: 'root' })
export class WorkspaceApiService {
  private readonly http = inject(HttpClient);

  readFile(projectId: string, path: string): Observable<RemoteWorkspaceFile> {
    return this.http.get<RemoteWorkspaceFile>(`${this.baseUrl(projectId)}/file`, {
      params: new HttpParams().set('path', path),
    });
  }

  saveFile(projectId: string, path: string, content: string): Observable<void> {
    return this.http.put<void>(`${this.baseUrl(projectId)}/file`, { path, content });
  }

  deleteFile(projectId: string, path: string): Observable<{ path: string; deleted: true }> {
    return this.http.delete<{ path: string; deleted: true }>(`${this.baseUrl(projectId)}/file`, {
      params: new HttpParams().set('path', path),
    });
  }

  toolchainStatus(projectId: string): Observable<WorkspaceToolchainStatus> {
    return this.http.get<WorkspaceToolchainStatus>(`${this.baseUrl(projectId)}/toolchain`);
  }

  build(
    projectId: string,
    target: 'build' | 'upload' = 'build',
    port?: string,
  ): Observable<WorkspaceBuildResult> {
    return this.http.post<WorkspaceBuildResult>(`${this.baseUrl(projectId)}/build`, {
      target,
      ...(port ? { port } : {}),
    });
  }

  devices(projectId: string): Observable<WorkspaceDeviceList> {
    return this.http.get<WorkspaceDeviceList>(`${this.baseUrl(projectId)}/devices`);
  }

  startSerialMonitor(
    projectId: string,
    port: string,
    baud: number,
  ): Observable<{ running: true; port: string; baud: number; cursor: number }> {
    return this.http.post<{ running: true; port: string; baud: number; cursor: number }>(
      `${this.baseUrl(projectId)}/serial/start`,
      { port, baud },
    );
  }

  serialOutput(projectId: string, cursor: number): Observable<SerialMonitorOutput> {
    return this.http.get<SerialMonitorOutput>(`${this.baseUrl(projectId)}/serial/output`, {
      params: new HttpParams().set('cursor', cursor),
    });
  }

  stopSerialMonitor(projectId: string): Observable<{ running: false }> {
    return this.http.post<{ running: false }>(`${this.baseUrl(projectId)}/serial/stop`, {});
  }

  private baseUrl(projectId: string): string {
    return `${environment.apiUrl}projects/${encodeURIComponent(projectId)}/workspace`;
  }
}
