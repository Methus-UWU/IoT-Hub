import { HttpException, NotFoundException } from '@nestjs/common';

import {
  AiCreditsRepository,
  AiSettingsRecord,
  CreditLimits,
  CreditOverrideRecord,
  TopUser,
  UsageEventInput,
} from './ai-credits.repository';
import { AiCreditsService, creditsFor } from './ai-credits.service';
import {
  creditWindows,
  DEFAULT_CREDIT_RESETS,
  CreditResetSchedule,
} from './credit-periods';

class FakeCredits extends AiCreditsRepository {
  current: AiSettingsRecord = {
    primaryModel: null,
    fallbackModels: [],
    defaults: { daily: -1, weekly: -1, monthly: -1 },
    resets: { ...DEFAULT_CREDIT_RESETS },
    updatedAt: new Date(),
  };
  readonly overridesByUser = new Map<string, CreditOverrideRecord>();
  readonly events: (UsageEventInput & { createdAt: Date })[] = [];
  clock = new Date('2026-10-11T03:00:00Z');

  settings() {
    return Promise.resolve(this.current);
  }
  updateSettings(
    patch: Partial<{
      primaryModel: string | null;
      fallbackModels: string[];
      defaults: CreditLimits;
      resets: CreditResetSchedule;
    }>,
  ) {
    this.current = { ...this.current, ...patch, updatedAt: new Date() };
    return Promise.resolve(this.current);
  }
  overrides() {
    return Promise.resolve([...this.overridesByUser.values()]);
  }
  override(userId: string) {
    return Promise.resolve(this.overridesByUser.get(userId) ?? null);
  }
  setOverride(
    userId: string,
    limits: {
      daily: number | null;
      weekly: number | null;
      monthly: number | null;
    },
    note: string,
  ) {
    const row = {
      userId,
      username: userId,
      email: '',
      ...limits,
      note,
      updatedAt: new Date(),
    };
    this.overridesByUser.set(userId, row);
    return Promise.resolve(row);
  }
  deleteOverride(userId: string) {
    return Promise.resolve(this.overridesByUser.delete(userId));
  }
  userExists(userId: string) {
    return Promise.resolve(userId !== 'ghost');
  }
  creditsSince(userId: string, since: Date[]) {
    return Promise.resolve(
      since.map((instant) =>
        this.events
          .filter(
            (event) => event.userId === userId && event.createdAt >= instant,
          )
          .reduce((sum, event) => sum + event.credits, 0),
      ),
    );
  }
  record(event: UsageEventInput) {
    this.events.push({ ...event, createdAt: this.clock });
    return Promise.resolve();
  }
  totalsSince(since: Date[]) {
    return Promise.resolve(
      since.map((instant) =>
        this.events
          .filter((event) => event.createdAt >= instant)
          .reduce((sum, event) => sum + event.credits, 0),
      ),
    );
  }
  topUsers(): Promise<TopUser[]> {
    return Promise.resolve([]);
  }
}

describe('AI credits', () => {
  let repository: FakeCredits;
  let credits: AiCreditsService;

  beforeEach(() => {
    repository = new FakeCredits();
    credits = new AiCreditsService(repository);
  });

  it('counts days, weeks, and months in Thailand time', () => {
    // 2026-10-11 is a Sunday. 03:00 UTC is 10:00 in Bangkok.
    const windows = creditWindows(new Date('2026-10-11T03:00:00Z'));
    expect(windows.daily.start.toISOString()).toBe('2026-10-10T17:00:00.000Z');
    expect(windows.daily.resetsAt.toISOString()).toBe(
      '2026-10-11T17:00:00.000Z',
    );
    expect(windows.weekly.start.toISOString()).toBe('2026-10-04T17:00:00.000Z');
    expect(windows.monthly.start.toISOString()).toBe(
      '2026-09-30T17:00:00.000Z',
    );
    expect(windows.monthly.resetsAt.toISOString()).toBe(
      '2026-10-31T17:00:00.000Z',
    );
    // 23:30 UTC on the 10th is already the 11th in Bangkok.
    expect(
      creditWindows(new Date('2026-10-10T23:30:00Z')).daily.start.toISOString(),
    ).toBe('2026-10-10T17:00:00.000Z');
  });

  it('refuses requests once a limit is spent, and says when it resets', async () => {
    await credits.updateSettings(
      { defaults: { daily: 2, weekly: -1, monthly: 100 } },
      'admin',
    );
    const now = repository.clock;
    await credits.assertCanUse('alice', now);
    await credits.record('alice', 'project', 'vendor/model');
    await credits.record('alice', 'advisor', 'vendor/model');

    const refusal = await credits
      .assertCanUse('alice', now)
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(HttpException);
    expect((refusal as HttpException).getStatus()).toBe(429);
    expect((refusal as HttpException).getResponse()).toMatchObject({
      code: 'AI_CREDIT_LIMIT_REACHED',
      period: 'daily',
      limit: 2,
      resetsAt: '2026-10-11T17:00:00.000Z',
    });
    // Another user has their own allowance.
    await expect(credits.assertCanUse('bob', now)).resolves.toBeUndefined();
  });

  it('applies a per-user override on top of the defaults', async () => {
    await credits.updateSettings(
      { defaults: { daily: 1, weekly: 10, monthly: 20 } },
      'admin',
    );
    await credits.setOverride(
      'alice',
      { daily: -1, weekly: null, monthly: 50 },
      'teacher',
    );

    expect(await credits.limitsFor('alice')).toEqual({
      daily: -1,
      weekly: 10,
      monthly: 50,
    });
    expect(await credits.limitsFor('bob')).toEqual({
      daily: 1,
      weekly: 10,
      monthly: 20,
    });
    await expect(
      credits.setOverride('ghost', { daily: 1, weekly: 1, monthly: 1 }, ''),
    ).rejects.toBeInstanceOf(NotFoundException);
    await credits.deleteOverride('alice');
    expect(await credits.limitsFor('alice')).toEqual({
      daily: 1,
      weekly: 10,
      monthly: 20,
    });
  });

  it('blocks until the latest exhausted period resets and applies the saved schedule', async () => {
    await credits.updateSettings(
      {
        defaults: { daily: 1, weekly: 1, monthly: 1 },
        resets: {
          ...DEFAULT_CREDIT_RESETS,
          dailyMinute: 480,
          weeklyDay: 2,
          monthlyDay: 15,
        },
      },
      'admin',
    );
    await credits.record('alice', 'project', 'vendor/model');
    const refusal = await credits
      .assertCanUse('alice', repository.clock)
      .catch((error: unknown) => error);
    expect((refusal as HttpException).getResponse()).toMatchObject({
      period: 'monthly',
      resetsAt: '2026-10-14T17:00:00.000Z',
    });
    await expect(
      credits.assertCanUse('alice', new Date('2026-10-14T17:00:00Z')),
    ).resolves.toBeUndefined();
    expect(
      (
        await credits.usageFor('alice', repository.clock)
      ).daily.resetsAt.toISOString(),
    ).toBe('2026-10-12T01:00:00.000Z');
  });

  it('gives the model order only when a primary is chosen', async () => {
    expect(await credits.modelOrder()).toEqual([]);
    await credits.updateSettings(
      {
        primaryModel: 'vendor/main',
        fallbackModels: ['vendor/backup', 'vendor/main'],
      },
      'admin',
    );
    expect(await credits.modelOrder()).toEqual([
      'vendor/main',
      'vendor/backup',
    ]);
  });

  it('reports usage per period', async () => {
    await credits.record('alice', 'project', 'vendor/model');
    const usage = await credits.usageFor('alice', repository.clock);
    expect(usage.daily).toMatchObject({ used: 1, limit: -1 });
    expect(usage.monthly.used).toBe(1);
    expect((await credits.summary(repository.clock)).totals).toEqual({
      daily: 1,
      weekly: 1,
      monthly: 1,
    });
  });

  it('charges by weighted tokens, at least one credit per answer', async () => {
    expect(creditsFor(undefined)).toBe(1);
    expect(creditsFor({ inputTokens: 300, outputTokens: 50 })).toBe(1);
    // A short question: 3,000 in + 300 out = 4,200 weighted.
    expect(creditsFor({ inputTokens: 3000, outputTokens: 300 })).toBe(3);
    // A whole project build: 60,000 in + 6,000 out = 84,000 weighted.
    expect(creditsFor({ inputTokens: 60000, outputTokens: 6000 })).toBe(42);

    await credits.updateSettings(
      { defaults: { daily: 50, weekly: -1, monthly: -1 } },
      'admin',
    );
    await credits.record('alice', 'project', 'vendor/model', {
      inputTokens: 60000,
      outputTokens: 6000,
    });
    const usage = await credits.usageFor('alice', repository.clock);
    expect(usage.daily.used).toBe(42);
    // Still under the limit, so the next request may run and take the total past it.
    await expect(
      credits.assertCanUse('alice', repository.clock),
    ).resolves.toBeUndefined();
    await credits.record('alice', 'project', 'vendor/model', {
      inputTokens: 30000,
      outputTokens: 3000,
    });
    await expect(
      credits.assertCanUse('alice', repository.clock),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
