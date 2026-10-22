/** Recurring credit windows in Thailand time (UTC+7). */
export type CreditPeriod = 'daily' | 'weekly' | 'monthly';
export const CREDIT_PERIODS: readonly CreditPeriod[] = [
  'daily',
  'weekly',
  'monthly',
];

const OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

export interface CreditResetSchedule {
  dailyMinute: number;
  weeklyMinute: number;
  /** Monday = 0, Sunday = 6. */
  weeklyDay: number;
  monthlyMinute: number;
  monthlyDay: number;
}

export const DEFAULT_CREDIT_RESETS: Readonly<CreditResetSchedule> = {
  dailyMinute: 0,
  weeklyMinute: 0,
  weeklyDay: 0,
  monthlyMinute: 0,
  monthlyDay: 1,
};

export interface PeriodWindow {
  start: Date;
  resetsAt: Date;
}

export function creditWindows(
  now: Date,
  schedule: CreditResetSchedule = DEFAULT_CREDIT_RESETS,
): Record<CreditPeriod, PeriodWindow> {
  // Work on a clock shifted to Bangkok, then shift the boundaries back to UTC.
  const local = new Date(now.getTime() + OFFSET_MS);
  const dayStart = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  const weekday = (local.getUTCDay() + 6) % 7; // Monday = 0
  let dailyStart = dayStart + schedule.dailyMinute * 60_000;
  if (dailyStart > local.getTime()) dailyStart -= DAY_MS;
  let weekStart =
    dayStart -
    ((weekday - schedule.weeklyDay + 7) % 7) * DAY_MS +
    schedule.weeklyMinute * 60_000;
  if (weekStart > local.getTime()) weekStart -= 7 * DAY_MS;
  const monthBoundary = (offset: number) =>
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth() + offset,
      schedule.monthlyDay,
    ) +
    schedule.monthlyMinute * 60_000;
  const monthOffset = monthBoundary(0) > local.getTime() ? -1 : 0;
  const back = (ms: number) => new Date(ms - OFFSET_MS);
  return {
    daily: { start: back(dailyStart), resetsAt: back(dailyStart + DAY_MS) },
    weekly: { start: back(weekStart), resetsAt: back(weekStart + 7 * DAY_MS) },
    monthly: {
      start: back(monthBoundary(monthOffset)),
      resetsAt: back(monthBoundary(monthOffset + 1)),
    },
  };
}
