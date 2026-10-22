import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { apiErrorMessage } from '../../../core/models/api-error';
import { CustomSelect } from '../../../shared/components/custom-select/custom-select';
import { AiSettingsClient, CreditResetSchedule } from './ai-settings.client';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

@Component({
  selector: 'app-credit-reset-settings',
  imports: [ReactiveFormsModule, CustomSelect],
  templateUrl: './credit-reset-settings.html',
  host: { class: 'mt-6 block border-t border-border pt-6' },
})
export class CreditResetSettings {
  private readonly api = inject(AiSettingsClient);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly schedule = input<CreditResetSchedule>();
  readonly saved = output<string>();
  readonly failed = output<string>();

  protected readonly saving = signal(false);
  protected readonly weekdays = [
    'จันทร์',
    'อังคาร',
    'พุธ',
    'พฤหัสบดี',
    'ศุกร์',
    'เสาร์',
    'อาทิตย์',
  ].map((label, index) => ({ value: String(index), label: `วัน${label}` }));
  protected readonly monthDays = Array.from({ length: 28 }, (_, index) => ({
    value: String(index + 1),
    label: `วันที่ ${index + 1}`,
  }));
  protected readonly form = this.fb.group({
    dailyTime: ['00:00', [Validators.required, Validators.pattern(TIME_PATTERN)]],
    weeklyTime: ['00:00', [Validators.required, Validators.pattern(TIME_PATTERN)]],
    weeklyDay: ['0', [Validators.required, Validators.pattern(/^[0-6]$/)]],
    monthlyTime: ['00:00', [Validators.required, Validators.pattern(TIME_PATTERN)]],
    monthlyDay: ['1', [Validators.required, Validators.pattern(/^([1-9]|1\d|2[0-8])$/)]],
  });

  constructor() {
    effect(() => {
      const schedule = this.schedule();
      this.form.reset({
        dailyTime: formatTime(schedule?.dailyMinute ?? 0),
        weeklyTime: formatTime(schedule?.weeklyMinute ?? 0),
        weeklyDay: String(schedule?.weeklyDay ?? 0),
        monthlyTime: formatTime(schedule?.monthlyMinute ?? 0),
        monthlyDay: String(schedule?.monthlyDay ?? 1),
      });
    });
  }

  protected setDay(period: 'weeklyDay' | 'monthlyDay', value: string): void {
    this.form.controls[period].setValue(value);
    this.form.markAsDirty();
  }

  protected async save(): Promise<void> {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    const form = this.form.getRawValue();
    try {
      await this.api.update({
        resets: {
          dailyMinute: minuteOfDay(form.dailyTime),
          weeklyMinute: minuteOfDay(form.weeklyTime),
          weeklyDay: Number(form.weeklyDay),
          monthlyMinute: minuteOfDay(form.monthlyTime),
          monthlyDay: Number(form.monthlyDay),
        },
      });
      this.form.markAsPristine();
      this.saved.emit('บันทึกรอบรีเซ็ตแล้ว');
    } catch (error: unknown) {
      this.failed.emit(apiErrorMessage(error) ?? 'บันทึกรอบรีเซ็ตไม่สำเร็จ');
    } finally {
      this.saving.set(false);
    }
  }
}

function formatTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function minuteOfDay(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}
