import 'reflect-metadata';
import { creditWindows, DEFAULT_CREDIT_RESETS } from './credit-periods';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAiSettingsDto } from '../ai/credits/dto/ai-settings.dto';

describe('configurable credit resets', () => {
  it('uses the previous day before the configured time and resets on the exact boundary', () => {
    const schedule = { ...DEFAULT_CREDIT_RESETS, dailyMinute: 510 };
    const before = creditWindows(
      new Date('2026-10-11T01:29:59Z'),
      schedule,
    ).daily;
    expect(before.start.toISOString()).toBe('2026-10-10T01:30:00.000Z');
    expect(before.resetsAt.toISOString()).toBe('2026-10-11T01:30:00.000Z');
    expect(creditWindows(before.resetsAt, schedule).daily.start).toEqual(
      before.resetsAt,
    );
  });

  it('uses the previous week before Friday at 18:15 Bangkok time', () => {
    const schedule = {
      ...DEFAULT_CREDIT_RESETS,
      weeklyDay: 4,
      weeklyMinute: 1095,
    };
    const window = creditWindows(
      new Date('2026-10-16T11:14:59Z'),
      schedule,
    ).weekly;
    expect(window.start.toISOString()).toBe('2026-10-09T11:15:00.000Z');
    expect(window.resetsAt.toISOString()).toBe('2026-10-16T11:15:00.000Z');
    expect(creditWindows(window.resetsAt, schedule).weekly.start).toEqual(
      window.resetsAt,
    );
  });

  it.each([
    '2027-02-27T17:00:00Z',
    '2028-02-27T17:00:00Z',
    '2026-12-27T17:00:00Z',
  ])('supports short months, leap years, and year boundaries at %s', (at) => {
    const schedule = { ...DEFAULT_CREDIT_RESETS, monthlyDay: 28 };
    const now = new Date(at);
    const window = creditWindows(now, schedule).monthly;
    expect(window.start).toEqual(now);
    expect(window.resetsAt.getTime()).toBeGreaterThan(now.getTime());
    expect(creditWindows(window.resetsAt, schedule).monthly.start).toEqual(
      window.resetsAt,
    );
  });

  it('validates all schedule fields at the API boundary', async () => {
    const dto = (resets: unknown) =>
      plainToInstance(UpdateAiSettingsDto, { resets });
    expect(await validate(dto(DEFAULT_CREDIT_RESETS))).toHaveLength(0);
    for (const resets of [
      null,
      [],
      {},
      { ...DEFAULT_CREDIT_RESETS, dailyMinute: 1440 },
      { ...DEFAULT_CREDIT_RESETS, weeklyDay: 7 },
      { ...DEFAULT_CREDIT_RESETS, monthlyDay: 29 },
      { ...DEFAULT_CREDIT_RESETS, weeklyMinute: 1.5 },
      { ...DEFAULT_CREDIT_RESETS, monthlyMinute: '30' },
    ]) {
      expect((await validate(dto(resets))).length).toBeGreaterThan(0);
    }
  });
});
