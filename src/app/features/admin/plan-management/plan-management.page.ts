import { Component, inject } from '@angular/core';

import { PlanLimits, PlanTier } from '../../../core/models/plan.model';
import { PlanCard } from './plan-card/plan-card';
import { PlanManagementStore } from './plan-management.store';

@Component({
  selector: 'app-plan-management-page',
  imports: [PlanCard],
  templateUrl: './plan-management.page.html'
})
export class PlanManagementPage {
  protected readonly store = inject(PlanManagementStore);

  protected onSave(tier: PlanTier, limits: PlanLimits): void {
    this.store.updateLimits(tier, limits);
  }
}
