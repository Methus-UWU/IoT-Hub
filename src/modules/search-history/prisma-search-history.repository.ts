import { Injectable } from '@nestjs/common';

import type { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SearchHistoryRepository,
  SearchHistoryView,
  SearchScope,
} from './search-history.repository';

@Injectable()
export class PrismaSearchHistoryRepository extends SearchHistoryRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async record(
    userId: string,
    scope: SearchScope,
    query: string,
    keep: number,
  ): Promise<void> {
    // Transactions use the primary even when ordinary reads use a replica.
    const database = this.prisma.db as Pick<PrismaClient, '$transaction'>;
    await database.$transaction(async (tx) => {
      await tx.searchHistoryEntry.upsert({
        where: { userId_scope_query: { userId, scope, query } },
        create: { userId, scope, query },
        update: { createdAt: new Date() },
      });

      const stale = await tx.searchHistoryEntry.findMany({
        where: { userId, scope },
        orderBy: { createdAt: 'desc' },
        skip: keep,
        select: { id: true },
      });
      if (stale.length) {
        await tx.searchHistoryEntry.deleteMany({
          where: { id: { in: stale.map((entry) => entry.id) } },
        });
      }
    });
  }

  list(
    userId: string,
    scope: SearchScope,
    limit: number,
  ): Promise<SearchHistoryView[]> {
    return this.prisma.db.searchHistoryEntry.findMany({
      where: { userId, scope },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { query: true, createdAt: true },
    });
  }

  async clear(userId: string, scope: SearchScope): Promise<void> {
    await this.prisma.db.searchHistoryEntry.deleteMany({
      where: { userId, scope },
    });
  }
}
