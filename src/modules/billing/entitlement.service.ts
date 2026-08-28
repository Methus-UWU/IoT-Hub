import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import {
  LIMIT_KEYS,
  LimitKey,
  PlanSummary,
  isUnlimited,
  usagePercent,
} from './entitlement';
import { PlanRepository } from './plan.repository';

export interface UsageMetric {
  key: string;
  label: string;
  used: number;
  limit: number;
  unlimited: boolean;
  percent: number;
  unit?: string;
}

export interface ProjectUsageReport {
  plan: { code: string; name: string };
  metrics: UsageMetric[];
}

export interface AccountUsageReport {
  plan: { code: string; name: string };
  metrics: UsageMetric[];
}

const BYTES_PER_MB = 1024 * 1024;

/**
 * The one place a plan limit is evaluated.
 *
 * Callers ask this service whether an action is allowed; they never compare a plan
 * code themselves. That keeps `if (plan === 'pro')` out of features, and means a
 * limit changes in one place.
 *
 * This is a security boundary. The frontend displays the same numbers for UX, but
 * only this check decides, and it runs before the write it guards.
 */
@Injectable()
export class EntitlementService {
  constructor(private readonly plans: PlanRepository) {}

  async planFor(userId: string): Promise<PlanSummary> {
    const plan = await this.plans.findPlanForUser(userId);

    if (!plan) {
      // The sign-up trigger assigns a plan in the same transaction as the
      // profile, so a missing subscription is a broken deployment. Failing
      // closed is the only safe reading: the alternative is granting
      // unlimited resources to an account we cannot price.
      throw new InternalServerErrorException({
        code: 'SUBSCRIPTION_MISSING',
        message: 'No subscription is configured for this account',
      });
    }

    return plan;
  }

  limitOf(plan: PlanSummary, key: LimitKey): number {
    return plan.limits[key] ?? 0;
  }

  /**
   * Refuses project creation once the plan's ceiling is reached.
   *
   * Throws rather than returning a boolean so a caller cannot forget to check the
   * result, and carries the numbers so the client can show a real message instead
   * of a generic failure.
   */
  async assertCanCreateProject(userId: string): Promise<void> {
    const plan = await this.planFor(userId);
    const limit = this.limitOf(plan, LIMIT_KEYS.maxProjects);
    if (isUnlimited(limit)) return;

    const { projectCount } = await this.plans.usageForUser(userId);
    if (projectCount < limit) return;

    throw new ConflictException({
      code: 'PROJECT_LIMIT_REACHED',
      message: `Your ${plan.name} plan supports up to ${limit} projects.`,
      limit,
      used: projectCount,
      planCode: plan.code,
    });
  }

  /** Everything the usage panel needs, from real data. */
  async usageReport(userId: string): Promise<AccountUsageReport> {
    const plan = await this.planFor(userId);
    const usage = await this.plans.usageForUser(userId);

    const storageLimitMb = this.limitOf(plan, LIMIT_KEYS.maxStorageMb);
    const storageUsedMb =
      Math.round((usage.storageBytes / BYTES_PER_MB) * 10) / 10;

    const metrics: UsageMetric[] = [
      this.metric(
        LIMIT_KEYS.maxProjects,
        'ACTIVE PROJECTS',
        usage.projectCount,
        this.limitOf(plan, LIMIT_KEYS.maxProjects),
      ),
      this.metric(
        LIMIT_KEYS.maxStorageMb,
        'PROJECT STORAGE',
        storageUsedMb,
        storageLimitMb,
        'MB',
      ),
      // Build minutes and AI requests are not metered yet: no build worker runs
      // (Phase 4) and AI usage is not recorded per user. Reporting 0 is honest;
      // inventing a number would put fabricated data back on this page, which is
      // the very thing this change removes.
      this.metric(
        LIMIT_KEYS.maxBuildMinutes,
        'BUILD MINUTES',
        0,
        this.limitOf(plan, LIMIT_KEYS.maxBuildMinutes),
        'min',
      ),
      this.metric(
        LIMIT_KEYS.maxAiRequests,
        'AI CREDITS',
        0,
        this.limitOf(plan, LIMIT_KEYS.maxAiRequests),
      ),
    ];

    return { plan: { code: plan.code, name: plan.name }, metrics };
  }

  /**
   * Usage inside one project, for the canvas.
   *
   * Counts are passed in rather than fetched here: the caller already holds the
   * component and connection repositories, and this service must not grow a
   * dependency on every table it reports on.
   */
  async projectUsageReport(
    userId: string,
    counts: { components: number; connections: number },
  ): Promise<ProjectUsageReport> {
    const plan = await this.planFor(userId);

    return {
      plan: { code: plan.code, name: plan.name },
      metrics: [
        this.metric(
          LIMIT_KEYS.maxComponentsPerProject,
          'DEVICES',
          counts.components,
          this.limitOf(plan, LIMIT_KEYS.maxComponentsPerProject),
        ),
        this.metric(
          LIMIT_KEYS.maxConnectionsPerProject,
          'CONNECTIONS',
          counts.connections,
          this.limitOf(plan, LIMIT_KEYS.maxConnectionsPerProject),
        ),
      ],
    };
  }

  private metric(
    key: string,
    label: string,
    used: number,
    limit: number,
    unit?: string,
  ): UsageMetric {
    return {
      key,
      label,
      used,
      limit,
      unlimited: isUnlimited(limit),
      percent: usagePercent(used, limit),
      ...(unit ? { unit } : {}),
    };
  }
}
