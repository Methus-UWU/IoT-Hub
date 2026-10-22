import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { PlanSummary } from './entitlement';
import { AccountUsage, PlanRepository } from './plan.repository';

@Injectable()
export class PrismaPlanRepository extends PlanRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findPlanForUser(userId: string): Promise<PlanSummary | null> {
    const subscription = await this.prisma.db.userSubscription.findUnique({
      where: { userId },
      select: {
        plan: {
          select: {
            code: true,
            name: true,
            limits: { select: { key: true, value: true } },
          },
        },
      },
    });

    if (!subscription) return null;

    return {
      code: subscription.plan.code,
      name: subscription.plan.name,
      limits: Object.fromEntries(
        subscription.plan.limits.map((limit) => [limit.key, limit.value]),
      ),
    };
  }

  async usageForUser(userId: string): Promise<AccountUsage> {
    // Scoped by membership, so a user's usage counts every workspace they can
    // create projects in, not only the personal one they own.
    const [projectCount, storage] = await Promise.all([
      this.prisma.db.project.count({
        where: { workspace: { members: { some: { userId } } } },
      }),
      this.prisma.db.projectFile.aggregate({
        where: { project: { workspace: { members: { some: { userId } } } } },
        _sum: { sizeBytes: true },
      }),
    ]);

    return {
      projectCount,
      storageBytes: storage._sum.sizeBytes ?? 0,
    };
  }

  async buildMillisSince(userId: string, since: Date): Promise<number> {
    const result = await this.prisma.db.buildJob.aggregate({
      where: { requestedBy: userId, createdAt: { gte: since } },
      _sum: { durationMs: true },
    });
    return result._sum.durationMs ?? 0;
  }
}
