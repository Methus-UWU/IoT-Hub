import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { DatabaseOverviewRepository } from './database-overview.repository';

@Injectable()
export class AdminDatabaseService {
  constructor(private readonly overview: DatabaseOverviewRepository) {}

  async getOverview() {
    try {
      const snapshot = await this.overview.readSnapshot();
      return {
        version: snapshot.version,
        sizeBytes: snapshot.sizeBytes,
        databaseConnections: snapshot.databaseConnections,
        maxConnections: snapshot.maxConnections,
        checkedAt: snapshot.checkedAt.toISOString(),
      };
    } catch {
      // Driver errors can contain connection details, including in development.
      throw new ServiceUnavailableException({
        code: 'DATABASE_OVERVIEW_UNAVAILABLE',
        message: 'Database overview is unavailable',
      });
    }
  }
}
