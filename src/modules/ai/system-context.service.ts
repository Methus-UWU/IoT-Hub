import { Injectable } from '@nestjs/common';
import {
  cpus,
  freemem,
  hostname,
  loadavg,
  platform,
  totalmem,
  uptime,
} from 'node:os';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SystemContextService {
  constructor(private readonly prisma: PrismaService) {}

  async build(): Promise<string> {
    const [userCountResult, activeSessionCountResult] =
      await Promise.allSettled([
        this.prisma.db.user.count(),
        this.prisma.db.session.count({
          where: { revokeAt: null, expireAt: { gt: new Date() } },
        }),
      ]);

    const totalMemory = totalmem();
    const freeMemory = freemem();
    const context = {
      capturedAt: new Date().toISOString(),
      runtime: {
        environment: process.env.NODE_ENV ?? 'development',
        host: hostname(),
        platform: platform(),
        cpuCores: cpus().length,
        loadAverage: loadavg().map((value) => Number(value.toFixed(2))),
        systemUptimeSeconds: Math.round(uptime()),
        apiUptimeSeconds: Math.round(process.uptime()),
        memory: {
          usedBytes: totalMemory - freeMemory,
          totalBytes: totalMemory,
          usedPercent: Number(
            (((totalMemory - freeMemory) / totalMemory) * 100).toFixed(1),
          ),
        },
      },
      application: {
        users:
          userCountResult.status === 'fulfilled'
            ? userCountResult.value
            : 'unavailable',
        activeSessions:
          activeSessionCountResult.status === 'fulfilled'
            ? activeSessionCountResult.value
            : 'unavailable',
        database:
          userCountResult.status === 'fulfilled' ? 'connected' : 'unavailable',
      },
    };

    return JSON.stringify(context, null, 2);
  }
}
