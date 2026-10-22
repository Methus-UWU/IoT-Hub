import { Injectable } from '@nestjs/common';

import type { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreditResetSchedule } from './credit-periods';
import {
  AiCreditsRepository,
  AiSettingsRecord,
  CreditLimits,
  CreditOverrideRecord,
  TopUser,
  UsageEventInput,
} from './ai-credits.repository';

const SETTINGS_ID = 1;

@Injectable()
export class PrismaAiCreditsRepository extends AiCreditsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async settings(): Promise<AiSettingsRecord> {
    // The migration seeds the row; upsert keeps a fresh database working too.
    const row = await this.prisma.db.aiSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID },
      update: {},
    });
    return toSettings(row);
  }

  async updateSettings(
    patch: Partial<{
      primaryModel: string | null;
      fallbackModels: string[];
      defaults: CreditLimits;
      resets: CreditResetSchedule;
    }>,
    updatedBy: string,
  ): Promise<AiSettingsRecord> {
    const data = {
      ...(patch.primaryModel !== undefined
        ? { primaryModel: patch.primaryModel }
        : {}),
      ...(patch.fallbackModels !== undefined
        ? { fallbackModels: patch.fallbackModels }
        : {}),
      ...(patch.defaults
        ? {
            dailyCredits: patch.defaults.daily,
            weeklyCredits: patch.defaults.weekly,
            monthlyCredits: patch.defaults.monthly,
          }
        : {}),
      updatedBy,
      ...(patch.resets
        ? {
            dailyResetMinute: patch.resets.dailyMinute,
            weeklyResetMinute: patch.resets.weeklyMinute,
            weeklyResetDay: patch.resets.weeklyDay,
            monthlyResetMinute: patch.resets.monthlyMinute,
            monthlyResetDay: patch.resets.monthlyDay,
          }
        : {}),
    };
    const row = await this.prisma.db.aiSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
    return toSettings(row);
  }

  async overrides(): Promise<CreditOverrideRecord[]> {
    const rows = await this.prisma.db.aiCreditOverride.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { user: { select: { username: true, email: true } } },
    });
    return rows.map(toOverride);
  }

  async override(userId: string): Promise<CreditOverrideRecord | null> {
    const row = await this.prisma.db.aiCreditOverride.findUnique({
      where: { userId },
      include: { user: { select: { username: true, email: true } } },
    });
    return row ? toOverride(row) : null;
  }

  async setOverride(
    userId: string,
    limits: {
      daily: number | null;
      weekly: number | null;
      monthly: number | null;
    },
    note: string,
  ): Promise<CreditOverrideRecord> {
    const data = {
      dailyCredits: limits.daily,
      weeklyCredits: limits.weekly,
      monthlyCredits: limits.monthly,
      note,
    };
    const row = await this.prisma.db.aiCreditOverride.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      include: { user: { select: { username: true, email: true } } },
    });
    return toOverride(row);
  }

  async deleteOverride(userId: string): Promise<boolean> {
    const result = await this.prisma.db.aiCreditOverride.deleteMany({
      where: { userId },
    });
    return result.count > 0;
  }

  async userExists(userId: string): Promise<boolean> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    return user !== null;
  }

  creditsSince(userId: string, since: Date[]): Promise<number[]> {
    return Promise.all(
      since.map(async (instant) => {
        const result = await this.prisma.db.aiUsageEvent.aggregate({
          where: { userId, createdAt: { gte: instant } },
          _sum: { credits: true },
        });
        return result._sum.credits ?? 0;
      }),
    );
  }

  async record(event: UsageEventInput): Promise<void> {
    await this.prisma.db.aiUsageEvent.create({ data: event });
  }

  totalsSince(since: Date[]): Promise<number[]> {
    return Promise.all(
      since.map(async (instant) => {
        const result = await this.prisma.db.aiUsageEvent.aggregate({
          where: { createdAt: { gte: instant } },
          _sum: { credits: true },
        });
        return result._sum.credits ?? 0;
      }),
    );
  }

  async topUsers(since: Date, limit: number): Promise<TopUser[]> {
    // groupBy is not callable through the read-replica extension's union type, so the
    // aggregate is a parameterised query.
    const database = this.prisma.db as Pick<PrismaClient, '$queryRaw'>;
    const rows = await database.$queryRaw<
      { user_id: string; username: string; credits: bigint }[]
    >`
      SELECT e.user_id, u.username, SUM(e.credits)::bigint AS credits
      FROM ai_usage_events e
      JOIN users u ON u.id = e.user_id
      WHERE e.created_at >= ${since}
      GROUP BY e.user_id, u.username
      ORDER BY credits DESC
      LIMIT ${limit}`;
    return rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      credits: Number(row.credits),
    }));
  }
}

function toSettings(row: {
  primaryModel: string | null;
  fallbackModels: string[];
  dailyCredits: number;
  weeklyCredits: number;
  monthlyCredits: number;
  dailyResetMinute: number;
  weeklyResetMinute: number;
  weeklyResetDay: number;
  monthlyResetMinute: number;
  monthlyResetDay: number;
  updatedAt: Date;
}): AiSettingsRecord {
  return {
    primaryModel: row.primaryModel,
    fallbackModels: row.fallbackModels,
    defaults: {
      daily: row.dailyCredits,
      weekly: row.weeklyCredits,
      monthly: row.monthlyCredits,
    },
    updatedAt: row.updatedAt,
    resets: {
      dailyMinute: row.dailyResetMinute,
      weeklyMinute: row.weeklyResetMinute,
      weeklyDay: row.weeklyResetDay,
      monthlyMinute: row.monthlyResetMinute,
      monthlyDay: row.monthlyResetDay,
    },
  };
}

function toOverride(row: {
  userId: string;
  dailyCredits: number | null;
  weeklyCredits: number | null;
  monthlyCredits: number | null;
  note: string;
  updatedAt: Date;
  user: { username: string; email: string };
}): CreditOverrideRecord {
  return {
    userId: row.userId,
    username: row.user.username,
    email: row.user.email,
    daily: row.dailyCredits,
    weekly: row.weeklyCredits,
    monthly: row.monthlyCredits,
    note: row.note,
    updatedAt: row.updatedAt,
  };
}
