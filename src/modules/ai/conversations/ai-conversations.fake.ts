import { randomUUID } from 'node:crypto';

import {
  AiConversationRecord,
  AiConversationRepository,
  AiConversationSummary,
  AiMessageRecord,
  AiPlanState,
  AiProfileInput,
  AiProfileRecord,
  AiProfileRepository,
  NewAiMessage,
} from './ai-conversation.repository';

/** In-memory repositories for the conversation tests. Test support only. */
export class FakeAiProfileRepository extends AiProfileRepository {
  readonly rows: AiProfileRecord[] = [];

  listVisible(userId: string): Promise<AiProfileRecord[]> {
    return Promise.resolve(
      this.rows.filter((row) => row.ownerId === null || row.ownerId === userId),
    );
  }

  findById(id: string): Promise<AiProfileRecord | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  countOwned(userId: string): Promise<number> {
    return Promise.resolve(
      this.rows.filter((row) => row.ownerId === userId).length,
    );
  }

  create(
    ownerId: string | null,
    input: AiProfileInput,
  ): Promise<AiProfileRecord> {
    const row = {
      id: randomUUID(),
      ownerId,
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  update(id: string, patch: Partial<AiProfileInput>): Promise<AiProfileRecord> {
    const row = this.rows.find((entry) => entry.id === id)!;
    Object.assign(row, patch, { updatedAt: new Date() });
    return Promise.resolve(row);
  }

  delete(id: string): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) this.rows.splice(index, 1);
    return Promise.resolve();
  }
}

export class FakeAiConversationRepository extends AiConversationRepository {
  readonly conversations: AiConversationRecord[] = [];
  readonly messageRows = new Map<string, AiMessageRecord[]>();
  private clock = 0;

  private tick(): Date {
    return new Date(Date.UTC(2026, 9, 11) + ++this.clock * 1000);
  }

  list(userId: string, projectId: string): Promise<AiConversationSummary[]> {
    return Promise.resolve(
      this.conversations
        .filter((row) => row.userId === userId && row.projectId === projectId)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((row) => ({
          ...row,
          messageCount: this.messageRows.get(row.id)?.length ?? 0,
        })),
    );
  }

  find(id: string): Promise<AiConversationRecord | null> {
    return Promise.resolve(
      this.conversations.find((row) => row.id === id) ?? null,
    );
  }

  async create(
    userId: string,
    projectId: string,
    profileId: string | null,
    keep: number,
  ): Promise<AiConversationRecord> {
    const older = (await this.list(userId, projectId)).slice(
      Math.max(keep - 1, 0),
    );
    for (const row of older) await this.delete(row.id);
    const now = this.tick();
    const row = {
      id: randomUUID(),
      userId,
      projectId,
      profileId,
      title: '',
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.push(row);
    this.messageRows.set(row.id, []);
    return row;
  }

  update(
    id: string,
    patch: { title?: string; profileId?: string | null },
  ): Promise<AiConversationRecord> {
    const row = this.conversations.find((entry) => entry.id === id)!;
    Object.assign(row, patch);
    return Promise.resolve(row);
  }

  delete(id: string): Promise<void> {
    const index = this.conversations.findIndex((row) => row.id === id);
    if (index >= 0) this.conversations.splice(index, 1);
    this.messageRows.delete(id);
    return Promise.resolve();
  }

  messages(conversationId: string, limit: number): Promise<AiMessageRecord[]> {
    return Promise.resolve(
      (this.messageRows.get(conversationId) ?? []).slice(-limit),
    );
  }

  appendMessage(
    conversationId: string,
    message: NewAiMessage,
    title?: string,
  ): Promise<AiMessageRecord> {
    const row = { ...message, id: randomUUID(), createdAt: this.tick() };
    this.messageRows.get(conversationId)!.push(row);
    const conversation = this.conversations.find(
      (entry) => entry.id === conversationId,
    )!;
    conversation.updatedAt = row.createdAt;
    if (title && !conversation.title) conversation.title = title;
    return Promise.resolve(row);
  }

  updatePlanState(
    conversationId: string,
    messageId: string,
    state: AiPlanState,
    error: string | null,
  ): Promise<boolean> {
    const row = this.messageRows
      .get(conversationId)
      ?.find(
        (entry) =>
          entry.id === messageId &&
          entry.role === 'assistant' &&
          entry.plan !== null,
      );
    if (!row) return Promise.resolve(false);
    row.planState = state;
    row.planError = error;
    return Promise.resolve(true);
  }
}
