import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AiCreditsRepository,
  AiSettingsRecord,
  CreditLimits,
  CreditOverrideRecord,
  TopUser,
} from './ai-credits.repository';
import {
  CREDIT_PERIODS,
  CreditPeriod,
  CreditResetSchedule,
  creditWindows,
} from './credit-periods';

/**
 * Credits follow the work the AI did, in tokens (ADR-009):
 *
 *   credits = max(1, ceil((input + 4 x output) / 2000))
 *
 * Output tokens weigh four times input, as providers price them. Every answered
 * message costs at least one credit, so a reply with no token count still counts.
 */
export const TOKENS_PER_CREDIT = 2000;
export const OUTPUT_TOKEN_WEIGHT = 4;
export const MIN_CREDITS_PER_REQUEST = 1;

export function creditsFor(usage?: {
  inputTokens?: number;
  outputTokens?: number;
}): number {
  const input = Math.max(0, usage?.inputTokens ?? 0);
  const output = Math.max(0, usage?.outputTokens ?? 0);
  const weighted = input + OUTPUT_TOKEN_WEIGHT * output;
  return Math.max(
    MIN_CREDITS_PER_REQUEST,
    Math.ceil(weighted / TOKENS_PER_CREDIT),
  );
}
const SETTINGS_TTL_MS = 15_000;

export interface PeriodUsage {
  used: number;
  /** -1 is unlimited. */
  limit: number;
  resetsAt: Date;
}

export type CreditUsage = Record<CreditPeriod, PeriodUsage>;

export interface UsageSummary {
  totals: Record<CreditPeriod, number>;
  /** The heaviest users this month. */
  topUsers: TopUser[];
}

const PERIOD_LABELS: Record<CreditPeriod, string> = {
  daily: 'รอบวัน',
  weekly: 'รอบสัปดาห์',
  monthly: 'รอบเดือน',
};

/** Enforces per-user token allowances before each AI turn. */
@Injectable()
export class AiCreditsService {
  private cached: { at: number; value: AiSettingsRecord } | null = null;

  constructor(private readonly repository: AiCreditsRepository) {}

  async settings(): Promise<AiSettingsRecord> {
    if (this.cached && Date.now() - this.cached.at < SETTINGS_TTL_MS) {
      return this.cached.value;
    }
    const value = await this.repository.settings();
    this.cached = { at: Date.now(), value };
    return value;
  }

  async updateSettings(
    patch: Partial<{
      primaryModel: string | null;
      fallbackModels: string[];
      defaults: CreditLimits;
      resets: CreditResetSchedule;
    }>,
    adminId: string,
  ): Promise<AiSettingsRecord> {
    const value = await this.repository.updateSettings(patch, adminId);
    this.cached = { at: Date.now(), value };
    return value;
  }

  /** The admin's model order: primary first, then fallbacks; empty when unset. */
  async modelOrder(): Promise<string[]> {
    const settings = await this.settings();
    if (!settings.primaryModel) return [];
    return [...new Set([settings.primaryModel, ...settings.fallbackModels])];
  }

  overrides(): Promise<CreditOverrideRecord[]> {
    return this.repository.overrides();
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
    if (!(await this.repository.userExists(userId))) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    return this.repository.setOverride(userId, limits, note);
  }

  async deleteOverride(userId: string): Promise<void> {
    if (!(await this.repository.deleteOverride(userId))) {
      throw new NotFoundException({
        code: 'AI_CREDIT_OVERRIDE_NOT_FOUND',
        message: 'This user has no custom limit',
      });
    }
  }

  /** The limits that apply to a user: the defaults, with their override on top. */
  async limitsFor(userId: string): Promise<CreditLimits> {
    const [settings, override] = await Promise.all([
      this.settings(),
      this.repository.override(userId),
    ]);
    return {
      daily: override?.daily ?? settings.defaults.daily,
      weekly: override?.weekly ?? settings.defaults.weekly,
      monthly: override?.monthly ?? settings.defaults.monthly,
    };
  }

  async usageFor(userId: string, now = new Date()): Promise<CreditUsage> {
    const windows = creditWindows(now, (await this.settings()).resets);
    const [limits, used] = await Promise.all([
      this.limitsFor(userId),
      this.repository.creditsSince(
        userId,
        CREDIT_PERIODS.map((period) => windows[period].start),
      ),
    ]);
    return Object.fromEntries(
      CREDIT_PERIODS.map((period, index) => [
        period,
        {
          used: used[index],
          limit: limits[period],
          resetsAt: windows[period].resetsAt,
        },
      ]),
    ) as CreditUsage;
  }

  /**
   * Refuses a request when any period's credits are spent. Runs before the provider
   * is called, so a refused request costs nothing. A request's cost is only known once
   * it is answered, so the last request before a limit may take the total past it.
   */
  async assertCanUse(userId: string, now = new Date()): Promise<void> {
    const usage = await this.usageFor(userId, now);
    const spent = CREDIT_PERIODS.filter(
      (period) =>
        usage[period].limit !== -1 && usage[period].used >= usage[period].limit,
    ).sort(
      (a, b) => usage[b].resetsAt.getTime() - usage[a].resetsAt.getTime(),
    )[0];
    if (!spent) return;
    const { limit, resetsAt } = usage[spent];
    throw new HttpException(
      {
        code: 'AI_CREDIT_LIMIT_REACHED',
        message: `ใช้ AI ครบ ${limit} credit ของ${PERIOD_LABELS[spent]}แล้ว ใช้ได้อีกครั้ง ${formatBangkok(resetsAt)}`,
        period: spent,
        limit,
        resetsAt: resetsAt.toISOString(),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Records one answered request at its token cost. A failed request is not charged. */
  async record(
    userId: string,
    feature: 'project' | 'advisor',
    model: string,
    usage?: { inputTokens?: number; outputTokens?: number },
  ): Promise<void> {
    await this.repository.record({
      userId,
      feature,
      model: model.slice(0, 160),
      credits: creditsFor(usage),
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
  }

  async summary(now = new Date()): Promise<UsageSummary> {
    const windows = creditWindows(now, (await this.settings()).resets);
    const [totals, topUsers] = await Promise.all([
      this.repository.totalsSince(
        CREDIT_PERIODS.map((period) => windows[period].start),
      ),
      this.repository.topUsers(windows.monthly.start, 10),
    ]);
    return {
      totals: { daily: totals[0], weekly: totals[1], monthly: totals[2] },
      topUsers,
    };
  }
}

function formatBangkok(at: Date): string {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(at);
}
