import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../../environments/environment';
import type { AiPlan } from '../../../core/models/project-ai.model';
import { WorkspaceContextService } from '../../../core/services/workspace-context.service';

export interface AiConversation {
  id: string;
  title: string;
  profileId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export interface StoredAiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  plan: AiPlan | null;
  planState: 'pending' | 'applied' | 'failed' | 'dismissed' | null;
  planError: string | null;
  model: string | null;
  createdAt: string;
}

export interface AiConversationDetail extends AiConversation {
  messages: StoredAiMessage[];
}

/**
 * The user's own conversations with one project's assistant, stored on the server.
 * They are private to the user and never cross projects; the server enforces both.
 */
@Service()
export class AiConversationsClient {
  private readonly http = inject(HttpClient);
  private readonly workspaces = inject(WorkspaceContextService);

  async list(projectId: string): Promise<AiConversation[]> {
    return firstValueFrom(this.http.get<AiConversation[]>(await this.url(projectId)));
  }

  async create(projectId: string, profileId: string | null): Promise<AiConversation> {
    return firstValueFrom(this.http.post<AiConversation>(await this.url(projectId), { profileId }));
  }

  /** Moves a conversation this browser kept before conversations were stored. */
  async importConversation(
    projectId: string,
    session: { title: string; messages: { role: 'user' | 'assistant'; content: string }[] },
  ): Promise<AiConversation> {
    return firstValueFrom(
      this.http.post<AiConversation>(`${await this.url(projectId)}/import`, session),
    );
  }

  async get(projectId: string, conversationId: string): Promise<AiConversationDetail> {
    return firstValueFrom(
      this.http.get<AiConversationDetail>(await this.url(projectId, conversationId)),
    );
  }

  async update(
    projectId: string,
    conversationId: string,
    patch: { title?: string; profileId?: string | null },
  ): Promise<AiConversation> {
    return firstValueFrom(
      this.http.patch<AiConversation>(await this.url(projectId, conversationId), patch),
    );
  }

  async remove(projectId: string, conversationId: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(await this.url(projectId, conversationId)));
  }

  async setPlanState(
    projectId: string,
    conversationId: string,
    messageId: string,
    planState: 'applied' | 'failed' | 'dismissed',
    planError?: string,
  ): Promise<void> {
    await firstValueFrom(
      this.http.patch<void>(
        `${await this.url(projectId, conversationId)}/messages/${encodeURIComponent(messageId)}`,
        { planState, ...(planError ? { planError: planError.slice(0, 500) } : {}) },
      ),
    );
  }

  private async url(projectId: string, conversationId?: string): Promise<string> {
    const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
    if (!workspace) throw new Error('No workspace is available for this account');
    const base = `${environment.apiUrl}workspaces/${encodeURIComponent(
      workspace.id,
    )}/projects/${encodeURIComponent(projectId)}/ai/conversations`;
    return conversationId ? `${base}/${encodeURIComponent(conversationId)}` : base;
  }
}
