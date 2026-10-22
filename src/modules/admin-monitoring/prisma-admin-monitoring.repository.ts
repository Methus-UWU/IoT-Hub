import { Injectable } from '@nestjs/common';

import type { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdminMonitoringRepository,
  type AdminDatabaseHealth,
  type AdminPlatformCounts,
} from './admin-monitoring.repository';

@Injectable()
export class PrismaAdminMonitoringRepository extends AdminMonitoringRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async readPlatformCounts(): Promise<AdminPlatformCounts> {
    const database = this.prisma.db;
    const [
      totalUsers,
      activeUsers,
      totalProjects,
      totalProjectFiles,
      totalCommunityPosts,
    ] = await Promise.all([
      database.user.count(),
      database.user.count({ where: { isActive: true } }),
      database.project.count(),
      database.projectFile.count(),
      database.communityPost.count(),
    ]);

    return {
      totalUsers,
      activeUsers,
      suspendedUsers: totalUsers - activeUsers,
      totalProjects,
      totalProjectFiles,
      totalCommunityPosts,
    };
  }

  async readDatabaseHealth(): Promise<AdminDatabaseHealth> {
    const database = this.prisma.db as Pick<PrismaClient, '$transaction'>;
    const startedAt = performance.now();
    const activeConnections = await database.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
        await transaction.$executeRaw`SET LOCAL statement_timeout = '3s'`;
        const [row] = await transaction.$queryRaw<
          Array<{ activeConnections: number }>
        >`
          SELECT numbackends AS "activeConnections"
          FROM pg_stat_database
          WHERE datname = current_database()
        `;
        if (!row) throw new Error('Database statistics are unavailable');
        return row.activeConnections;
      },
      { maxWait: 2000, timeout: 5000 },
    );

    return {
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      activeConnections,
    };
  }
}
