import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';

import { LIMIT_KEYS, PlanSummary, UNLIMITED } from './entitlement';
import { EntitlementService } from './entitlement.service';
import { AccountUsage, PlanRepository } from './plan.repository';

class FakePlanRepository extends PlanRepository {
  plan: PlanSummary | null = {
    code: 'free',
    name: 'Free',
    limits: {
      [LIMIT_KEYS.maxProjects]: 5,
      [LIMIT_KEYS.maxStorageMb]: 1024,
      [LIMIT_KEYS.maxBuildMinutes]: 120,
      [LIMIT_KEYS.maxAiRequests]: 5000,
    },
  };

  usage: AccountUsage = { projectCount: 0, storageBytes: 0 };

  findPlanForUser(): Promise<PlanSummary | null> {
    return Promise.resolve(this.plan);
  }

  usageForUser(): Promise<AccountUsage> {
    return Promise.resolve(this.usage);
  }
}

describe('EntitlementService', () => {
  let plans: FakePlanRepository;
  let service: EntitlementService;

  beforeEach(() => {
    plans = new FakePlanRepository();
    service = new EntitlementService(plans);
  });

  describe('project limit', () => {
    it('allows creation below the limit', async () => {
      plans.usage = { projectCount: 4, storageBytes: 0 };

      await expect(
        service.assertCanCreateProject('user-1'),
      ).resolves.toBeUndefined();
    });

    it('refuses creation at the limit', async () => {
      plans.usage = { projectCount: 5, storageBytes: 0 };

      await expect(
        service.assertCanCreateProject('user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses creation above the limit', async () => {
      plans.usage = { projectCount: 9, storageBytes: 0 };

      await expect(
        service.assertCanCreateProject('user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reports the limit so the client can explain it', async () => {
      plans.usage = { projectCount: 5, storageBytes: 0 };

      const response = await service
        .assertCanCreateProject('user-1')
        .catch((error: ConflictException) => error.getResponse());

      expect(response).toMatchObject({
        code: 'PROJECT_LIMIT_REACHED',
        limit: 5,
        used: 5,
        planCode: 'free',
      });
    });

    it('never blocks an unlimited plan', async () => {
      plans.plan = {
        code: 'max',
        name: 'Max',
        limits: { [LIMIT_KEYS.maxProjects]: UNLIMITED },
      };
      plans.usage = { projectCount: 10_000, storageBytes: 0 };

      await expect(
        service.assertCanCreateProject('user-1'),
      ).resolves.toBeUndefined();
    });

    it('fails closed when no subscription exists', async () => {
      // Granting unlimited resources to an account we cannot price would be the
      // dangerous reading of a missing row.
      plans.plan = null;

      await expect(
        service.assertCanCreateProject('user-1'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('treats an unknown limit key as zero rather than unlimited', async () => {
      plans.plan = { code: 'broken', name: 'Broken', limits: {} };
      plans.usage = { projectCount: 0, storageBytes: 0 };

      await expect(
        service.assertCanCreateProject('user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('usage report', () => {
    it('reports zero projects for a brand-new account', async () => {
      const report = await service.usageReport('user-1');
      const projects = report.metrics.find(
        (metric) => metric.key === LIMIT_KEYS.maxProjects,
      );

      expect(projects).toMatchObject({ used: 0, limit: 5, percent: 0 });
    });

    it('reports real project counts', async () => {
      plans.usage = { projectCount: 3, storageBytes: 0 };

      const report = await service.usageReport('user-1');
      const projects = report.metrics.find(
        (metric) => metric.key === LIMIT_KEYS.maxProjects,
      );

      expect(projects).toMatchObject({ used: 3, limit: 5, percent: 60 });
    });

    it('converts stored bytes to megabytes', async () => {
      plans.usage = { projectCount: 0, storageBytes: 5 * 1024 * 1024 };

      const report = await service.usageReport('user-1');
      const storage = report.metrics.find(
        (metric) => metric.key === LIMIT_KEYS.maxStorageMb,
      );

      expect(storage).toMatchObject({ used: 5, unit: 'MB' });
    });

    it('marks unlimited metrics rather than showing a fake percentage', async () => {
      plans.plan = {
        code: 'max',
        name: 'Max',
        limits: { [LIMIT_KEYS.maxProjects]: UNLIMITED },
      };
      plans.usage = { projectCount: 42, storageBytes: 0 };

      const report = await service.usageReport('user-1');
      const projects = report.metrics.find(
        (metric) => metric.key === LIMIT_KEYS.maxProjects,
      );

      expect(projects).toMatchObject({ unlimited: true, percent: 0, used: 42 });
    });

    it('reports the plan the numbers belong to', async () => {
      const report = await service.usageReport('user-1');

      expect(report.plan).toEqual({ code: 'free', name: 'Free' });
    });

    it('never invents usage for unmetered resources', async () => {
      // Build minutes and AI credits are not metered yet. Reporting 0 is honest;
      // a sample number would be exactly the fabricated data this work removes.
      const report = await service.usageReport('user-1');
      const build = report.metrics.find(
        (metric) => metric.key === LIMIT_KEYS.maxBuildMinutes,
      );

      expect(build?.used).toBe(0);
    });
  });
});
