import { Injectable } from '@nestjs/common';

import type { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SignInIpRepository } from './sign-in-ip.repository';

/**
 * Seconds a session's start may differ from `last_sign_in_at` and still count as
 * that sign-in. Both are written by the same Supabase request, so they normally
 * agree to well under a second.
 */
const SAME_SIGN_IN_SECONDS = 60;

/**
 * Reads `auth.sessions`, which Supabase owns: the Admin API exposes no session
 * addresses. Read-only; Prisma never manages the `auth` schema.
 *
 * Sessions disappear on sign-out and expiry, so the newest remaining session may
 * be an older sign-in. It is only reported when it started at `last_sign_in_at`;
 * otherwise the address is unknown rather than wrong.
 */
@Injectable()
export class PrismaSignInIpRepository extends SignInIpRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listLatest(): Promise<ReadonlyMap<string, string>> {
    const rows = await this.query(null);
    return new Map(rows.map((row) => [row.userId, row.ip]));
  }

  async findLatest(userId: string): Promise<string | null> {
    const [row] = await this.query(userId);
    return row?.ip ?? null;
  }

  private query(userId: string | null) {
    const database = this.prisma.db as Pick<PrismaClient, '$queryRaw'>;
    return database.$queryRaw<Array<{ userId: string; ip: string }>>`
      SELECT u.id::text AS "userId", host(s.ip) AS ip
      FROM auth.users u
      CROSS JOIN LATERAL (
        SELECT ip, created_at
        FROM auth.sessions
        WHERE user_id = u.id
        ORDER BY created_at DESC
        LIMIT 1
      ) s
      WHERE (${userId}::uuid IS NULL OR u.id = ${userId}::uuid)
        AND s.ip IS NOT NULL
        AND u.last_sign_in_at IS NOT NULL
        AND abs(extract(epoch FROM s.created_at - u.last_sign_in_at))
          <= ${SAME_SIGN_IN_SECONDS}
    `;
  }
}
