import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { apiErrorMessage } from '../../../core/models/api-error';
import type { AdminUser } from '../../../core/models/admin.model';
import { CustomSelect } from '../../../shared/components/custom-select/custom-select';
import {
  AiSettingsClient,
  CreditLimits,
  CreditOverride,
  CreditResetSchedule,
  UsageSummary,
} from './ai-settings.client';
import { CreditResetSettings } from './credit-reset-settings';
import { IntegrationsSkeleton } from './integrations-skeleton';

type Period = keyof CreditLimits;

/** One limit in a form: unlimited, a number, or (overrides only) the default. */
interface LimitField {
  mode: 'unlimited' | 'limit' | 'default';
  value: number;
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'daily', label: 'ต่อวัน' },
  { key: 'weekly', label: 'ต่อสัปดาห์' },
  { key: 'monthly', label: 'ต่อเดือน' },
];

function fieldOf(value: number | null): LimitField {
  if (value === null) return { mode: 'default', value: 0 };
  if (value === -1) return { mode: 'unlimited', value: 0 };
  return { mode: 'limit', value };
}

function valueOf(field: LimitField): number | null {
  if (field.mode === 'default') return null;
  if (field.mode === 'unlimited') return -1;
  return Math.max(0, Math.round(field.value));
}

/** Edits per-user allowances; the server enforces token costs and reset periods. */
@Component({
  selector: 'app-ai-credits-panel',
  imports: [NgTemplateOutlet, CustomSelect, CreditResetSettings, IntegrationsSkeleton],
  templateUrl: './ai-credits-panel.html',
  styleUrl: './ai-credits-panel.css',
  host: { class: 'block' },
})
export class AiCreditsPanel {
  private readonly api = inject(AiSettingsClient);

  readonly defaults = input.required<CreditLimits>();
  readonly resets = input<CreditResetSchedule>();
  readonly message = output<string>();
  readonly failed = output<string>();

  protected readonly periods = PERIODS;
  protected readonly defaultForm = signal<Record<Period, LimitField>>({
    daily: fieldOf(-1),
    weekly: fieldOf(-1),
    monthly: fieldOf(-1),
  });
  protected readonly savingDefaults = signal(false);
  /** Loading problems stay inline; save results go out through `message` and `failed`. */
  protected readonly error = signal<string | null>(null);

  protected readonly usage = signal<UsageSummary | null>(null);
  protected readonly overrides = signal<CreditOverride[]>([]);
  protected readonly users = signal<AdminUser[]>([]);
  protected readonly loading = signal(true);

  protected readonly editingUserId = signal<string>('');
  protected readonly overrideForm = signal<Record<Period, LimitField>>({
    daily: fieldOf(null),
    weekly: fieldOf(null),
    monthly: fieldOf(null),
  });
  protected readonly overrideNote = signal('');
  protected readonly savingOverride = signal(false);
  protected readonly confirmingRemove = signal<string | null>(null);

  protected readonly userOptions = computed(() =>
    this.users().map((user) => ({
      value: user.id,
      label: user.username,
      description: user.email,
    })),
  );
  protected readonly defaultsInvalid = computed(() =>
    Object.values(this.defaultForm()).some((field) => this.invalidLimit(field)),
  );
  protected readonly overrideInvalid = computed(() =>
    Object.values(this.overrideForm()).some((field) => this.invalidLimit(field)),
  );

  protected invalidLimit(field: LimitField): boolean {
    return (
      field.mode === 'limit' &&
      (!Number.isInteger(field.value) || field.value < 0 || field.value > 1_000_000)
    );
  }

  private readonly seed = effect(() => {
    const defaults = this.defaults();
    untracked(() =>
      this.defaultForm.set({
        daily: fieldOf(defaults.daily),
        weekly: fieldOf(defaults.weekly),
        monthly: fieldOf(defaults.monthly),
      }),
    );
  });

  constructor() {
    void this.refresh();
  }

  protected limitText(value: number | null, fallback: number): string {
    const effective = value ?? fallback;
    const text = effective === -1 ? 'ไม่จำกัด' : `${effective}`;
    return value === null ? `${text} (ค่าเริ่มต้น)` : text;
  }

  protected setMode(form: 'default' | 'override', period: Period, mode: LimitField['mode']): void {
    const target = form === 'default' ? this.defaultForm : this.overrideForm;
    target.update((fields) => ({ ...fields, [period]: { ...fields[period], mode } }));
  }

  protected setValue(form: 'default' | 'override', period: Period, raw: string): void {
    const target = form === 'default' ? this.defaultForm : this.overrideForm;
    const value = raw.trim() ? Number(raw) : Number.NaN;
    target.update((fields) => ({
      ...fields,
      [period]: { mode: 'limit', value },
    }));
  }

  protected async saveDefaults(): Promise<void> {
    if (this.savingDefaults() || this.defaultsInvalid()) return;
    this.savingDefaults.set(true);
    try {
      const form = this.defaultForm();
      await this.api.update({
        defaults: {
          daily: valueOf(form.daily) ?? -1,
          weekly: valueOf(form.weekly) ?? -1,
          monthly: valueOf(form.monthly) ?? -1,
        },
      });
      this.message.emit('บันทึก limit ค่าเริ่มต้นแล้ว');
    } catch (error: unknown) {
      this.failed.emit(apiErrorMessage(error) ?? 'บันทึก limit ไม่สำเร็จ');
    } finally {
      this.savingDefaults.set(false);
    }
  }

  protected onResetsSaved(message: string): void {
    this.message.emit(message);
    void this.refresh();
  }

  protected editOverride(override: CreditOverride): void {
    this.editingUserId.set(override.userId);
    this.overrideForm.set({
      daily: fieldOf(override.daily),
      weekly: fieldOf(override.weekly),
      monthly: fieldOf(override.monthly),
    });
    this.overrideNote.set(override.note);
  }

  protected startOverride(userId: string): void {
    const existing = this.overrides().find((entry) => entry.userId === userId);
    if (existing) {
      this.editOverride(existing);
      return;
    }
    this.editingUserId.set(userId);
    this.overrideForm.set({ daily: fieldOf(null), weekly: fieldOf(null), monthly: fieldOf(null) });
    this.overrideNote.set('');
  }

  protected async saveOverride(): Promise<void> {
    const userId = this.editingUserId();
    if (!userId || this.savingOverride() || this.overrideInvalid()) return;
    this.savingOverride.set(true);
    try {
      const form = this.overrideForm();
      await this.api.setOverride(userId, {
        daily: valueOf(form.daily),
        weekly: valueOf(form.weekly),
        monthly: valueOf(form.monthly),
        note: this.overrideNote().trim(),
      });
      this.editingUserId.set('');
      this.message.emit('บันทึก limit เฉพาะผู้ใช้แล้ว');
      await this.refresh();
    } catch (error: unknown) {
      this.failed.emit(apiErrorMessage(error) ?? 'บันทึก limit เฉพาะผู้ใช้ไม่สำเร็จ');
    } finally {
      this.savingOverride.set(false);
    }
  }

  protected async removeOverride(userId: string): Promise<void> {
    this.confirmingRemove.set(null);
    try {
      await this.api.deleteOverride(userId);
      this.message.emit('ลบ limit เฉพาะผู้ใช้แล้ว กลับไปใช้ค่าเริ่มต้น');
      await this.refresh();
    } catch (error: unknown) {
      this.failed.emit(apiErrorMessage(error) ?? 'ลบไม่สำเร็จ');
    }
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [usage, overrides, users] = await Promise.all([
        this.api.usage(),
        this.api.overrides(),
        this.users().length ? Promise.resolve(this.users()) : this.api.users(),
      ]);
      this.usage.set(usage);
      this.overrides.set(overrides);
      this.users.set(users);
    } catch (error: unknown) {
      this.error.set(apiErrorMessage(error) ?? 'โหลดข้อมูล credit ไม่สำเร็จ');
    } finally {
      this.loading.set(false);
    }
  }
}
