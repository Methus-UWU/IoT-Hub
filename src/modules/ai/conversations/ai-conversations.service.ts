import { Injectable, NotFoundException } from '@nestjs/common';

import {
  AiConversationRecord,
  AiConversationRepository,
  AiConversationSummary,
  AiMessageRecord,
  AiPlanState,
} from './ai-conversation.repository';
import { AiProfilesService } from './ai-profiles.service';

/** Conversations kept per user per project; starting one more drops the oldest. */
export const MAX_CONVERSATIONS_PER_PROJECT = 50;
/** Messages a conversation returns when opened. */
export const MESSAGES_SHOWN = 200;

export interface AiConversationDetail extends AiConversationRecord {
  messages: AiMessageRecord[];
}

/**
 * The project assistant's conversation history, on the server.
 *
 * A conversation is private to the user who started it and belongs to one project.
 * The controller has already proved the user may see the project; every method here
 * also requires that the conversation is theirs and in that project, so a guessed id
 * from another project or another member is a 404.
 */
@Injectable()
export class AiConversationsService {
  constructor(
    private readonly conversations: AiConversationRepository,
    private readonly profiles: AiProfilesService,
  ) {}

  list(userId: string, projectId: string): Promise<AiConversationSummary[]> {
    return this.conversations.list(userId, projectId);
  }

  async create(
    userId: string,
    projectId: string,
    profileId: string | null,
  ): Promise<AiConversationRecord> {
    if (profileId) await this.profiles.requireUsable(userId, profileId);
    return this.conversations.create(
      userId,
      projectId,
      profileId,
      MAX_CONVERSATIONS_PER_PROJECT,
    );
  }

  async get(
    userId: string,
    projectId: string,
    id: string,
  ): Promise<AiConversationDetail> {
    const conversation = await this.requireOwned(userId, projectId, id);
    return {
      ...conversation,
      messages: await this.conversations.messages(id, MESSAGES_SHOWN),
    };
  }

  /**
   * Moves a conversation the browser kept before ADR-007 into this project. The messages
   * are stored in order; plans are not imported, so nothing can be applied from them.
   */
  async importConversation(
    userId: string,
    projectId: string,
    title: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<AiConversationRecord> {
    const conversation = await this.conversations.create(
      userId,
      projectId,
      null,
      MAX_CONVERSATIONS_PER_PROJECT,
    );
    const firstQuestion =
      messages.find((message) => message.role === 'user')?.content ?? '';
    const name = (title || firstQuestion)
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 60);
    for (const message of messages) {
      await this.conversations.appendMessage(
        conversation.id,
        {
          role: message.role,
          content: message.content,
          plan: null,
          planState: null,
          planError: null,
          model: null,
        },
        name || undefined,
      );
    }
    return (await this.conversations.find(conversation.id)) ?? conversation;
  }

  /** Renames it, or switches its profile; earlier messages are kept either way. */
  async update(
    userId: string,
    projectId: string,
    id: string,
    patch: { title?: string; profileId?: string | null },
  ): Promise<AiConversationRecord> {
    await this.requireOwned(userId, projectId, id);
    if (patch.profileId)
      await this.profiles.requireUsable(userId, patch.profileId);
    return this.conversations.update(id, patch);
  }

  async delete(userId: string, projectId: string, id: string): Promise<void> {
    await this.requireOwned(userId, projectId, id);
    await this.conversations.delete(id);
  }

  /** Records what became of a proposal: applied, failed, or dismissed. */
  async setPlanState(
    userId: string,
    projectId: string,
    id: string,
    messageId: string,
    state: Exclude<AiPlanState, 'pending'>,
    error: string | null,
  ): Promise<void> {
    await this.requireOwned(userId, projectId, id);
    const updated = await this.conversations.updatePlanState(
      id,
      messageId,
      state,
      state === 'failed' ? (error ?? '').slice(0, 500) : null,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'AI_MESSAGE_NOT_FOUND',
        message: 'That message has no proposal in this conversation',
      });
    }
  }

  async requireOwned(
    userId: string,
    projectId: string,
    id: string,
  ): Promise<AiConversationRecord> {
    const conversation = await this.conversations.find(id);
    if (
      !conversation ||
      conversation.userId !== userId ||
      conversation.projectId !== projectId
    ) {
      throw new NotFoundException({
        code: 'AI_CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }
    return conversation;
  }
}
