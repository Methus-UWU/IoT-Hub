import type { CreditResetSchedule } from './credit-periods';

/** -1 is unlimited; null in an override keeps the default. */
export interface CreditLimits {
  daily: number;
  weekly: number;
  monthly: number;
}

export interface AiSettingsRecord {
  primaryModel: string | null;
  fallbackModels: string[];
  defaults: CreditLimits;
  resets: CreditResetSchedule;
  updatedAt: Date;
}

export interface CreditOverrideRecord {
  userId: string;
  username: string;
  email: string;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  note: string;
  updatedAt: Date;
}

export interface UsageEventInput {
  userId: string;
  feature: 'project' | 'advisor';
  model: string;
  credits: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface TopUser {
  userId: string;
  username: string;
  credits: number;
}

export abstract class AiCreditsRepository {
  abstract settings(): Promise<AiSettingsRecord>;

  abstract updateSettings(
    patch: Partial<{
      primaryModel: string | null;
      fallbackModels: string[];
      defaults: CreditLimits;
      resets: CreditResetSchedule;
    }>,
    updatedBy: string,
  ): Promise<AiSettingsRecord>;

  abstract overrides(): Promise<CreditOverrideRecord[]>;

  abstract override(userId: string): Promise<CreditOverrideRecord | null>;

  abstract setOverride(
    userId: string,
    limits: {
      daily: number | null;
      weekly: number | null;
      monthly: number | null;
    },
    note: string,
  ): Promise<CreditOverrideRecord>;

  /** Returns false when there was no override. */
  abstract deleteOverride(userId: string): Promise<boolean>;

  abstract userExists(userId: string): Promise<boolean>;

  /** Credits a user spent since each instant, in one read. */
  abstract creditsSince(userId: string, since: Date[]): Promise<number[]>;

  abstract record(event: UsageEventInput): Promise<void>;

  /** Credits spent by everyone since each instant. */
  abstract totalsSince(since: Date[]): Promise<number[]>;

  abstract topUsers(since: Date, limit: number): Promise<TopUser[]>;
}
