export interface AdminPlatformCounts {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  totalProjects: number;
  totalProjectFiles: number;
  totalCommunityPosts: number;
}

export interface AdminDatabaseHealth {
  latencyMs: number;
  activeConnections: number;
}

export abstract class AdminMonitoringRepository {
  abstract readPlatformCounts(): Promise<AdminPlatformCounts>;
  abstract readDatabaseHealth(): Promise<AdminDatabaseHealth>;
}
