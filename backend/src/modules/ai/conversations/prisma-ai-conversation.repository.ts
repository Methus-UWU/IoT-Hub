import { Injectable } from '@nestjs/common';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AiConversationRecord,
  AiConversationRepository,
  AiConversationSummary,
  AiMessageRecord,
  AiPlanState,
  AiProfileInput,
  AiProfileRecord,
  AiProfileRepository,
  AiProfileTier,
  NewAiMessage,
} from './ai-conversation.repository';

const CONVERSATION_SELECT = {
  id: true,
  userId: true,
  projectId: true,
  title: true,
  profileId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const MESSAGE_SELECT = {
  id: true,
  role: true,
  content: true,
  plan: true,
  planState: true,
  planError: true,
  model: true,
  createdAt: true,
} as const;

function toProfile(row: {
  id: string;
  name: string;
  description: string;
  model: string | null;
  tier: string;
  instructions: string;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AiProfileRecord {
  return { ...row, tier: row.tier as AiProfileTier };
}

function toMessage(row: {
  id: string;
  role: string;
  content: string;
  plan: Prisma.JsonValue;
  planState: string | null;
  planError: string | null;
  model: string | null;
  createdAt: Date;
}): AiMessageRecord {
  return {
    ...row,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    plan: row.plan,
    planState: row.planState as AiPlanState | null,
  };
}

@Injectable()
export class PrismaAiProfileRepository extends AiProfileRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listVisible(userId: string): Promise<AiProfileRecord[]> {
    const rows = await this.prisma.db.aiProfile.findMany({
      where: { OR: [{ ownerId: null }, { ownerId: userId }] },
      // System profiles (null owner) first, then the user's, each by name.
      orderBy: [{ ownerId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });
    return rows.map(toProfile);
  }

  async findById(id: string): Promise<AiProfileRecord | null> {
    const row = await this.prisma.db.aiProfile.findUnique({ where: { id } });
    return row ? toProfile(row) : null;
  }

  countOwned(userId: string): Promise<number> {
    return this.prisma.db.aiProfile.count({ where: { ownerId: userId } });
  }

  async create(
    ownerId: string | null,
    input: AiProfileInput,
  ): Promise<AiProfileRecord> {
    return toProfile(
      await this.prisma.db.aiProfile.create({ data: { ...input, ownerId } }),
    );
  }

  async update(
    id: string,
    patch: Partial<AiProfileInput>,
  ): Promise<AiProfileRecord> {
    return toProfile(
      await this.prisma.db.aiProfile.update({ where: { id }, data: patch }),
    );
  }

  async delete(id: string): Promise<void> {
    await this.prisma.db.aiProfile.deleteMany({ where: { id } });
  }
}

@Injectable()
export class PrismaAiConversationRepository extends AiConversationRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(
    userId: string,
    projectId: string,
  ): Promise<AiConversationSummary[]> {
    const rows = await this.prisma.db.aiConversation.findMany({
      where: { userId, projectId },
      orderBy: { updatedAt: 'desc' },
      select: {
        ...CONVERSATION_SELECT,
        _count: { select: { messages: true } },
      },
    });
    return rows.map(({ _count, ...row }) => ({
      ...row,
      messageCount: _count.messages,
    }));
  }

  find(id: string): Promise<AiConversationRecord | null> {
    return this.prisma.db.aiConversation.findUnique({
      where: { id },
      select: CONVERSATION_SELECT,
    });
  }

  create(
    userId: string,
    projectId: string,
    profileId: string | null,
    keep: number,
  ): Promise<AiConversationRecord> {
    const database = this.prisma.db as Pick<PrismaClient, '$transaction'>;
    return database.$transaction(async (tx) => {
      const older = await tx.aiConversation.findMany({
        where: { userId, projectId },
        orderBy: { updatedAt: 'desc' },
        skip: Math.max(keep - 1, 0),
        select: { id: true },
      });
      if (older.length) {
        await tx.aiConversation.deleteMany({
          where: { id: { in: older.map((row) => row.id) } },
        });
      }
      return tx.aiConversation.create({
        data: { userId, projectId, profileId },
        select: CONVERSATION_SELECT,
      });
    });
  }

  update(
    id: string,
    patch: { title?: string; profileId?: string | null },
  ): Promise<AiConversationRecord> {
    return this.prisma.db.aiConversation.update({
      where: { id },
      data: patch,
      select: CONVERSATION_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.db.aiConversation.deleteMany({ where: { id } });
  }

  async messages(
    conversationId: string,
    limit: number,
  ): Promise<AiMessageRecord[]> {
    // Transactions read the primary: a turn reads the history right after writing it.
    const database = this.prisma.db as Pick<PrismaClient, '$transaction'>;
    const rows = await database.$transaction((tx) =>
      tx.aiMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: MESSAGE_SELECT,
      }),
    );
    return rows.reverse().map(toMessage);
  }

  appendMessage(
    conversationId: string,
    message: NewAiMessage,
    title?: string,
  ): Promise<AiMessageRecord> {
    const database = this.prisma.db as Pick<PrismaClient, '$transaction'>;
    return database.$transaction(async (tx) => {
      const created = await tx.aiMessage.create({
        data: {
          conversationId,
          role: message.role,
          content: message.content,
          plan:
            message.plan === null || message.plan === undefined
              ? Prisma.DbNull
              : (message.plan as Prisma.InputJsonValue),
          planState: message.planState,
          planError: message.planError,
          model: message.model,
        },
        select: MESSAGE_SELECT,
      });
      // Touch the conversation so it sorts first; name it after its first question.
      await tx.aiConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      if (title) {
        await tx.aiConversation.updateMany({
          where: { id: conversationId, title: '' },
          data: { title },
        });
      }
      return toMessage(created);
    });
  }

  async updatePlanState(
    conversationId: string,
    messageId: string,
    state: AiPlanState,
    error: string | null,
  ): Promise<boolean> {
    const result = await this.prisma.db.aiMessage.updateMany({
      where: {
        id: messageId,
        conversationId,
        role: 'assistant',
        plan: { not: Prisma.DbNull },
      },
      data: { planState: state, planError: error },
    });
    return result.count > 0;
  }
}
