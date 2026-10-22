import { Service, inject } from '@angular/core';
import { HttpClient, HttpDownloadProgressEvent, HttpEventType } from '@angular/common/http';
import { NEVER, firstValueFrom, fromEvent, lastValueFrom, takeUntil, tap } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  AiPlanAction,
  AiProgressEvent,
  ApplyPlanResult,
  ProjectAiChatRequest,
  ProjectAiChatResponse,
} from '../../../core/models/project-ai.model';
import { WorkspaceContextService } from '../../../core/services/workspace-context.service';

/**
 * Client for the project assistant.
 *
 * Every call is addressed by workspace and project, and carries no description of the
 * hardware: the server reads the project's own components, wiring, and files. That is the
 * point of the feature — the browser cannot tell the assistant which board it has, so a
 * page with stale state cannot make it answer about the wrong one.
 */
@Service()
export class ProjectAiService {
  private readonly http = inject(HttpClient);
  private readonly workspaces = inject(WorkspaceContextService);

  async chat(projectId: string, request: ProjectAiChatRequest): Promise<ProjectAiChatResponse> {
    const workspaceId = await this.requireWorkspaceId();
    return firstValueFrom(
      this.http.post<ProjectAiChatResponse>(
        `${this.baseUrl(workspaceId, projectId)}/chat`,
        request,
      ),
    );
  }

  /**
   * The same turn as `chat`, reporting each step as the server takes it.
   *
   * The server streams newline-delimited JSON. Lines are parsed as they arrive and every
   * progress line goes to `onProgress`; the promise settles on the final result or error
   * line, so a caller awaits it exactly as it would `chat`.
   */
  async chatStream(
    projectId: string,
    request: ProjectAiChatRequest,
    onProgress: (event: AiProgressEvent) => void,
    signal?: AbortSignal,
  ): Promise<ProjectAiChatResponse> {
    const workspaceId = await this.requireWorkspaceId();
    let consumed = 0;
    let outcome: StreamOutcome | null = null;

    const readLines = (text: string) => {
      const end = text.lastIndexOf(NEWLINE);
      if (end < consumed) return;
      const lines = text.slice(consumed, end).split(NEWLINE);
      consumed = end + 1;
      for (const line of lines) {
        const message = parseStreamLine(line);
        if (!message) continue;
        if (message.type === 'progress')
          onProgress({ stage: message.stage, detail: message.detail, status: message.status });
        else outcome = message;
      }
    };

    const response = await lastValueFrom(
      this.http
        .post(`${this.baseUrl(workspaceId, projectId)}/chat/stream`, request, {
          observe: 'events',
          reportProgress: true,
          responseType: 'text',
        })
        .pipe(
          tap((event) => {
            if (event.type === HttpEventType.DownloadProgress) {
              readLines((event as HttpDownloadProgressEvent).partialText ?? '');
            }
          }),
          // Unsubscribing cancels the request, and the server stops the turn with it.
          takeUntil(signal ? fromEvent(signal, 'abort') : NEVER),
        ),
    );
    if (response.type === HttpEventType.Response) readLines(`${response.body ?? ''}${NEWLINE}`);

    const settled = outcome as StreamOutcome | null;
    if (!settled) throw new Error('AI ตอบกลับไม่ครบ กรุณาลองใหม่อีกครั้ง');
    if (settled.type === 'error') throw new Error(settled.error.message);
    return settled.result;
  }

  /** Sends an accepted plan back for validation and execution. */
  async apply(projectId: string, actions: readonly AiPlanAction[]): Promise<ApplyPlanResult> {
    const workspaceId = await this.requireWorkspaceId();
    return firstValueFrom(
      this.http.post<ApplyPlanResult>(`${this.baseUrl(workspaceId, projectId)}/apply`, { actions }),
    );
  }

  private baseUrl(workspaceId: string, projectId: string): string {
    return `${environment.apiUrl}workspaces/${encodeURIComponent(
      workspaceId,
    )}/projects/${encodeURIComponent(projectId)}/ai`;
  }

  private async requireWorkspaceId(): Promise<string> {
    const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
    if (!workspace) throw new Error('No workspace is available for this account');
    return workspace.id;
  }
}

const NEWLINE = '\n';

type StreamOutcome =
  | { type: 'result'; result: ProjectAiChatResponse }
  | { type: 'error'; error: { code: string; message: string } };

type StreamLine = ({ type: 'progress' } & AiProgressEvent) | StreamOutcome;

function parseStreamLine(line: string): StreamLine | null {
  if (!line.trim()) return null;
  try {
    const value = JSON.parse(line) as StreamLine;
    return value && typeof value === 'object' && 'type' in value ? value : null;
  } catch {
    return null;
  }
}
