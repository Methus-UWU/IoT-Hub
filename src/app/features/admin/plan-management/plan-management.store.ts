import { Injectable, signal } from '@angular/core';

import { PlanConfig, PlanLimits, PlanTier } from '../../../core/models/plan.model';

const INITIAL_PLANS: PlanConfig[] = [
  {
    tier: 'free',
    name: 'Free',
    description: 'Get started with basic IoT monitoring.',
    priceMonthly: 0,
    limits: { deviceLimit: 5, projectLimit: 1, storageLimitGb: 1 },
    usage: { userCount: 842, avgDeviceUsagePercent: 62, avgStorageUsagePercent: 48 }
  },
  {
    tier: 'pro',
    name: 'Pro',
    description: 'For growing teams running production deployments.',
    priceMonthly: 29,
    limits: { deviceLimit: 50, projectLimit: 10, storageLimitGb: 25 },
    usage: { userCount: 356, avgDeviceUsagePercent: 71, avgStorageUsagePercent: 66 }
  },
  {
    tier: 'max',
    name: 'Max',
    description: 'Unlimited scale for large fleets and enterprises.',
    priceMonthly: 99,
    limits: { deviceLimit: 500, projectLimit: 50, storageLimitGb: 250 },
    usage: { userCount: 86, avgDeviceUsagePercent: 38, avgStorageUsagePercent: 41 }
  }
];

@Injectable({ providedIn: 'root' })
export class PlanManagementStore {
  private readonly _plans = signal<PlanConfig[]>(INITIAL_PLANS);
  readonly plans = this._plans.asReadonly();

  updateLimits(tier: PlanTier, limits: PlanLimits): void {
    this._plans.update((plans) => plans.map((plan) => (plan.tier === tier ? { ...plan, limits } : plan)));
  }
}
