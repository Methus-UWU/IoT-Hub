export interface DatabaseSnapshot {
  version: string;
  sizeBytes: number;
  databaseConnections: number;
  maxConnections: number;
  checkedAt: Date;
}

export abstract class DatabaseOverviewRepository {
  abstract readSnapshot(): Promise<DatabaseSnapshot>;
}
