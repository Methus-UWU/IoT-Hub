export type PlanTier = 'free' | 'pro' | 'max';

export interface PlanLimits {
  deviceLimit: number;
  projectLimit: number;
  storageLimitGb: number;
}

export interface PlanUsage {
  userCount: number;
  avgDeviceUsagePercent: number;
  avgStorageUsagePercent: number;
}

export interface PlanConfig {
  tier: PlanTier;
  name: string;
  description: string;
  priceMonthly: number;
  limits: PlanLimits;
  usage: PlanUsage;
}
