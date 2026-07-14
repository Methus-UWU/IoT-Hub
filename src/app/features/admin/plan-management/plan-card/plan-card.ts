import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { FormField, form, min, required } from '@angular/forms/signals';

import { PlanConfig, PlanLimits, PlanTier } from '../../../../core/models/plan.model';

const TIER_ACCENT_BORDER: Record<PlanTier, string> = {
  free: 'border-t-gray-300',
  pro: 'border-t-primary',
  max: 'border-t-amber-500'
};

const USAGE_BAR_CLASSES = (percent: number): string => {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
};

@Component({
  selector: 'app-plan-card',
  imports: [FormField, DecimalPipe],
  templateUrl: './plan-card.html'
})
export class PlanCard {
  readonly plan = input.required<PlanConfig>();
  readonly save = output<PlanLimits>();

  protected readonly editing = signal(false);

  private readonly draft = signal<PlanLimits>({ deviceLimit: 1, projectLimit: 1, storageLimitGb: 1 });
  protected readonly draftForm = form(this.draft, (path) => {
    required(path.deviceLimit);
    min(path.deviceLimit, 1);
    required(path.projectLimit);
    min(path.projectLimit, 1);
    required(path.storageLimitGb);
    min(path.storageLimitGb, 1);
  });

  protected readonly accentBorderClasses = computed(() => TIER_ACCENT_BORDER[this.plan().tier]);
  protected readonly deviceUsageBarClasses = computed(() => USAGE_BAR_CLASSES(this.plan().usage.avgDeviceUsagePercent));
  protected readonly storageUsageBarClasses = computed(() =>
    USAGE_BAR_CLASSES(this.plan().usage.avgStorageUsagePercent)
  );

  protected startEdit(): void {
    this.draft.set({ ...this.plan().limits });
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  protected submitEdit(): void {
    if (!this.draftForm().valid()) {
      return;
    }
    this.save.emit(this.draft());
    this.editing.set(false);
  }
}
