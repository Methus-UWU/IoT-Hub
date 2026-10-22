import { AdminRequestLogStore } from './admin-request-log.store';
import { AdminMonitoringRepository } from './admin-monitoring.repository';
import { AdminMonitoringService } from './admin-monitoring.service';

describe('AdminMonitoringService', () => {
  const counts = {
    totalUsers: 12,
    activeUsers: 10,
    suspendedUsers: 2,
    totalProjects: 7,
    totalProjectFiles: 28,
    totalCommunityPosts: 4,
  };

  function createRepository(): jest.Mocked<AdminMonitoringRepository> {
    return {
      readPlatformCounts: jest.fn().mockResolvedValue(counts),
      readDatabaseHealth: jest.fn().mockResolvedValue({
        latencyMs: 8,
        activeConnections: 3,
      }),
    };
  }

  it('returns repository counts and measured database health', async () => {
    const repository = createRepository();
    const service = new AdminMonitoringService(
      repository,
      new AdminRequestLogStore(),
    );

    const snapshot = await service.getSnapshot();

    expect(snapshot.platform).toEqual(counts);
    expect(snapshot.database).toEqual({
      state: 'connected',
      latencyMs: 8,
      activeConnections: 3,
    });
    expect(snapshot.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'NestJS API', state: 'running' }),
        expect.objectContaining({ name: 'PostgreSQL', state: 'running' }),
      ]),
    );
    expect(snapshot.cpu.usedPercent).toBeGreaterThanOrEqual(0);
    expect(snapshot.memory.usedBytes).toBeGreaterThan(0);
  });

  it('reports unavailable database data without inventing replacement values', async () => {
    const repository = createRepository();
    repository.readPlatformCounts.mockRejectedValue(new Error('offline'));
    repository.readDatabaseHealth.mockRejectedValue(new Error('offline'));
    const service = new AdminMonitoringService(
      repository,
      new AdminRequestLogStore(),
    );

    const snapshot = await service.getSnapshot();

    expect(snapshot.platform).toBeNull();
    expect(snapshot.database).toEqual({
      state: 'disconnected',
      latencyMs: null,
      activeConnections: null,
    });
    expect(snapshot.services).toContainEqual(
      expect.objectContaining({ name: 'PostgreSQL', state: 'unavailable' }),
    );
  });
});
