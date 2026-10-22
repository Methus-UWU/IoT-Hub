import { Injectable } from '@nestjs/common';

import type { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DatabaseOverviewRepository,
  type DatabaseSnapshot,
} from './database-overview.repository';

@Injectable()
export class PrismaDatabaseOverviewRepository extends DatabaseOverviewRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  readSnapshot(): Promise<DatabaseSnapshot> {
    // Transactions use the primary even when ordinary reads use a replica.
    // The replica extension changes generated overload types, not this API.
    const database = this.prisma.db as Pick<PrismaClient, '$transaction'>;
    return database.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
        await transaction.$executeRaw`SET LOCAL statement_timeout = '5s'`;
        const [snapshot] = await transaction.$queryRaw<DatabaseSnapshot[]>`
          SELECT current_setting('server_version') AS version,
                 pg_database_size(current_database())::double precision AS "sizeBytes",
                 numbackends AS "databaseConnections",
                 current_setting('max_connections')::integer AS "maxConnections",
                 statement_timestamp() AS "checkedAt"
          FROM pg_stat_database
          WHERE datname = current_database()
        `;
        if (!snapshot) throw new Error('Database statistics are unavailable');
        return snapshot;
      },
      { maxWait: 2000, timeout: 7000 },
    );
  }
}
