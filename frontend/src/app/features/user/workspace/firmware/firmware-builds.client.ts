import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { WorkspaceContextService } from '../../../../core/services/workspace-context.service';
import { environment } from '../../../../../environments/environment';

export type BuildStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type BuildFailureReason = 'compile' | 'rejected' | 'timeout' | 'worker_error' | 'artifacts';
export type FlashProtocol = 'esptool' | 'stk500v1' | 'stk500v2';

export interface FlashMethod {
  protocol: FlashProtocol;
  baudRate: number;
}

export interface BuildArtifact {
  name: string;
  /** ESP32 flash address; null for a HEX image, which carries its own. */
  flashOffset: number | null;
  sizeBytes: number;
  sha256: string;
}

export interface FirmwareBuild {
  id: string;
  status: BuildStatus;
  boardId: string;
  failureReason: BuildFailureReason | null;
  durationMs: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  artifacts: BuildArtifact[];
  /** How the browser flashes this build; null when it cannot. */
  flash: FlashMethod | null;
  /** Present on a single build, not in lists. */
  log?: string;
}

export const ACTIVE_BUILD_STATUSES: readonly BuildStatus[] = ['queued', 'running'];

/**
 * Firmware builds of a project (`/workspaces/:wid/projects/:pid/builds`).
 *
 * The server compiles in an isolated worker; this client only queues, reads, and
 * downloads. Every call is re-authorized by the API.
 */
@Service()
export class FirmwareBuildsClient {
  private readonly http = inject(HttpClient);
  private readonly workspaces = inject(WorkspaceContextService);

  /** Queues a build of the stored files, or returns an identical finished one. */
  async request(projectId: string): Promise<{ build: FirmwareBuild; reused: boolean }> {
    return firstValueFrom(
      this.http.post<{ build: FirmwareBuild; reused: boolean }>(await this.url(projectId), {}),
    );
  }

  async get(projectId: string, buildId: string): Promise<FirmwareBuild> {
    return firstValueFrom(
      this.http.get<FirmwareBuild>(`${await this.url(projectId)}/${encodeURIComponent(buildId)}`),
    );
  }

  async cancel(projectId: string, buildId: string): Promise<FirmwareBuild> {
    return firstValueFrom(
      this.http.post<FirmwareBuild>(
        `${await this.url(projectId)}/${encodeURIComponent(buildId)}/cancel`,
        {},
      ),
    );
  }

  async artifact(projectId: string, buildId: string, name: string): Promise<Uint8Array> {
    const buffer = await firstValueFrom(
      this.http.get(
        `${await this.url(projectId)}/${encodeURIComponent(buildId)}/artifacts/${encodeURIComponent(name)}`,
        { responseType: 'arraybuffer' },
      ),
    );
    return new Uint8Array(buffer);
  }

  private async url(projectId: string): Promise<string> {
    const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
    if (!workspace) throw new Error('No workspace is available for this account');
    return `${environment.apiUrl}workspaces/${encodeURIComponent(workspace.id)}/projects/${encodeURIComponent(projectId)}/builds`;
  }
}
