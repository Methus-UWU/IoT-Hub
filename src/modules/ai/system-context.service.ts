import { Injectable } from '@nestjs/common';
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os';

import { SessionRepository } from '../auth/session.repository';
import { UserRepository } from '../users/user.repository';

/**
 * Builds the read-only context attached to admin AI requests.
 *
 * Security boundary: the payload is an explicit allowlist of aggregate values,
 * never a projection of the environment or of any configuration object. Adding a
 * field here sends it to a third-party provider, so anything identifying the host
 * or carrying a credential must not be added. `hostname()` and `platform()` were
 * removed for that reason.
 */
@Injectable()
export class SystemContextService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
  ) {}

  async build(): Promise<string> {
    const [userCountResult, activeSessionCountResult] =
      await Promise.allSettled([
        this.users.count(),
        this.sessions.countActive(),
      ]);

    const totalMemory = totalmem();
    const freeMemory = freemem();
    const context = {
      capturedAt: new Date().toISOString(),
      runtime: {
        environment: process.env.NODE_ENV ?? 'development',
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
