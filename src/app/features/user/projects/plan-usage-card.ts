import { Component, input } from '@angular/core';

export interface UsageMetric {
  label: string;
  value: string;
  limit: string;
  percent: number;
}

@Component({
  selector: 'app-plan-usage-card',
  templateUrl: './plan-usage-card.html',
  styleUrl: './plan-usage-card.css',
})
export class PlanUsageCard {
  readonly metrics = input.required<readonly UsageMetric[]>();
}
