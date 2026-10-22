import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AdminUser } from '../../../core/models/admin.model';
import { environment } from '../../../../environments/environment';

/** -1 is unlimited. */
export interface CreditLimits {
  daily: number;
  weekly: number;
  monthly: number;
}

export interface CreditResetSchedule {
  dailyMinute: number;
  weeklyMinute: number;
  weeklyDay: number;
  monthlyMinute: number;
  monthlyDay: number;
}

export interface CatalogOption {
  id: string;
  name: string;
  vendor: string;
  isFree: boolean;
  supportsTools: boolean;
  contextLength: number;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
}

export interface AiSettings {
  primaryModel: string | null;
  fallbackModels: string[];
  defaults: CreditLimits;
  resets?: CreditResetSchedule;
  updatedAt: string;
  catalog: { stale: boolean; fetchedAt: string; models: CatalogOption[]; latencyOrder?: string[] };
}

export interface CreditOverride {
  userId: string;
  username: string;
  email: string;
  /** null keeps the default; -1 is unlimited. */
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  note: string;
  updatedAt: string;
}

export interface UsageSummary {
  totals: { daily: number; weekly: number; monthly: number };
  topUsers: { userId: string; username: string; credits: number }[];
}

/** The integrations page's AI settings API. Admin only; the server checks the role. */
@Injectable()
export class AiSettingsClient {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}admin/ai-settings`;

  settings(): Promise<AiSettings> {
    return firstValueFrom(this.http.get<AiSettings>(this.base));
  }

  update(patch: {
    primaryModel?: string | null;
    fallbackModels?: string[];
    defaults?: CreditLimits;
    resets?: CreditResetSchedule;
  }): Promise<Omit<AiSettings, 'catalog'>> {
    return firstValueFrom(this.http.put<Omit<AiSettings, 'catalog'>>(this.base, patch));
  }

  overrides(): Promise<CreditOverride[]> {
    return firstValueFrom(this.http.get<CreditOverride[]>(`${this.base}/overrides`));
  }

  setOverride(
    userId: string,
    body: { daily: number | null; weekly: number | null; monthly: number | null; note: string },
  ): Promise<CreditOverride> {
    return firstValueFrom(
      this.http.put<CreditOverride>(`${this.base}/overrides/${encodeURIComponent(userId)}`, body),
    );
  }

  async deleteOverride(userId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<void>(`${this.base}/overrides/${encodeURIComponent(userId)}`),
    );
  }

  usage(): Promise<UsageSummary> {
    return firstValueFrom(this.http.get<UsageSummary>(`${this.base}/usage`));
  }

  users(): Promise<AdminUser[]> {
    return firstValueFrom(this.http.get<AdminUser[]>(`${environment.apiUrl}admin/users`));
  }
}
