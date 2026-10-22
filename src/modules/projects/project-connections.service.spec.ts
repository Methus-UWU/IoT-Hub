import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { LIMIT_KEYS, PlanSummary, UNLIMITED } from '../billing/entitlement';
import { EntitlementService } from '../billing/entitlement.service';
import { AccountUsage, PlanRepository } from '../billing/plan.repository';
import { ProjectConnectionsService } from './project-connections.service';
import {
  CreateConnectionInput,
  ProjectConnection,
  ProjectConnectionRepository,
} from './project.repository';

const PROJECT = 'project-1';
const BOARD = 'component-board';
const LED = 'component-led';

class FakeConnectionRepository extends ProjectConnectionRepository {
  private readonly rows = new Map<
    string,
    ProjectConnection & { projectId: string }
  >();
  private sequence = 0;
  /** Component ids the fake considers to be inside PROJECT. */
  ownedComponents = new Set([BOARD, LED]);

  list(projectId: string): Promise<ProjectConnection[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.projectId === projectId),
    );
  }

  count(projectId: string): Promise<number> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.projectId === projectId)
        .length,
    );
  }

  create(
    projectId: string,
    input: CreateConnectionInput,
  ): Promise<ProjectConnection> {
    const row = {
      id: `wire-${++this.sequence}`,
      projectId,
      from: input.from,
      to: input.to,
      color: input.color ?? '#2563eb',
      kind: input.kind ?? ('signal' as const),
      waypoints: input.waypoints ?? [],
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  updateWaypoints(
    projectId: string,
    connectionId: string,
    waypoints: { x: number; y: number }[],
  ): Promise<ProjectConnection | null> {
    const row = this.rows.get(connectionId);
    if (!row || row.projectId !== projectId) return Promise.resolve(null);
    row.waypoints = waypoints;
    return Promise.resolve(row);
  }

  delete(projectId: string, connectionId: string): Promise<boolean> {
    const row = this.rows.get(connectionId);
    if (!row || row.projectId !== projectId) return Promise.resolve(false);
    this.rows.delete(connectionId);
    return Promise.resolve(true);
  }

  endpointsBelongToProject(
    _projectId: string,
    componentIds: readonly string[],
  ): Promise<boolean> {
    return Promise.resolve(
      componentIds.every((id) => this.ownedComponents.has(id)),
    );
  }
}

class FakePlanRepository extends PlanRepository {
  plan: PlanSummary = {
    code: 'free',
    name: 'Free',
    limits: { [LIMIT_KEYS.maxConnectionsPerProject]: 3 },
  };

  findPlanForUser(): Promise<PlanSummary> {
    return Promise.resolve(this.plan);
  }

  usageForUser(): Promise<AccountUsage> {
    return Promise.resolve({ projectCount: 0, storageBytes: 0 });
  }

  buildMillisSince(): Promise<number> {
    return Promise.resolve(0);
  }
}

function wire(pin = 'GPIO23'): CreateConnectionInput {
  return {
    from: { componentId: BOARD, pinId: pin },
    to: { componentId: LED, pinId: 'anode' },
  };
}

describe('ProjectConnectionsService', () => {
  let connections: FakeConnectionRepository;
  let plans: FakePlanRepository;
  let service: ProjectConnectionsService;

  beforeEach(() => {
    connections = new FakeConnectionRepository();
    plans = new FakePlanRepository();
    service = new ProjectConnectionsService(
      connections,
      new EntitlementService(plans),
    );
  });

  describe('endpoints', () => {
    it('connects two pins', async () => {
      const created = await service.add('user-1', PROJECT, wire());

      expect(created.from).toEqual({ componentId: BOARD, pinId: 'GPIO23' });
      expect(created.to).toEqual({ componentId: LED, pinId: 'anode' });
    });

    it('refuses a pin wired to itself', async () => {
      await expect(
        service.add('user-1', PROJECT, {
          from: { componentId: BOARD, pinId: 'GPIO23' },
          to: { componentId: BOARD, pinId: 'GPIO23' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows two different pins on the same component', async () => {
      await expect(
        service.add('user-1', PROJECT, {
          from: { componentId: BOARD, pinId: 'GPIO23' },
          to: { componentId: BOARD, pinId: 'GND-L' },
        }),
      ).resolves.toBeDefined();
    });

    it('refuses a component from another project', async () => {
      // The endpoint check is what stops a wire being anchored to someone
      // else's component by id.
      await expect(
        service.add('user-1', PROJECT, {
          from: { componentId: BOARD, pinId: 'GPIO23' },
          to: { componentId: 'component-from-elsewhere', pinId: 'anode' },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not count a refused wire against the limit', async () => {
      await service
        .add('user-1', PROJECT, {
          from: { componentId: BOARD, pinId: 'X' },
          to: { componentId: 'outsider', pinId: 'Y' },
        })
        .catch(() => undefined);

      await expect(connections.count(PROJECT)).resolves.toBe(0);
    });
  });

  describe('connection limit', () => {
    it('allows adding below the limit', async () => {
      await service.add('user-1', PROJECT, wire('GPIO1'));
      await service.add('user-1', PROJECT, wire('GPIO2'));

      await expect(
        service.add('user-1', PROJECT, wire('GPIO3')),
      ).resolves.toBeDefined();
    });

    it('refuses once the ceiling is reached', async () => {
      for (const pin of ['GPIO1', 'GPIO2', 'GPIO3']) {
        await service.add('user-1', PROJECT, wire(pin));
      }

      await expect(
        service.add('user-1', PROJECT, wire('GPIO4')),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reports the ceiling so the client can offer an upgrade', async () => {
      for (const pin of ['GPIO1', 'GPIO2', 'GPIO3']) {
        await service.add('user-1', PROJECT, wire(pin));
      }

      const response = await service
        .add('user-1', PROJECT, wire('GPIO4'))
        .catch((error: ConflictException) => error.getResponse());

      expect(response).toMatchObject({
        code: 'CONNECTION_LIMIT_REACHED',
        limit: 3,
        used: 3,
      });
    });

    it('never blocks an unlimited plan', async () => {
      plans.plan = {
        code: 'max',
        name: 'Max',
        limits: { [LIMIT_KEYS.maxConnectionsPerProject]: UNLIMITED },
      };

      for (let index = 0; index < 20; index++) {
        await service.add('user-1', PROJECT, wire(`GPIO${index}`));
      }

      await expect(
        service.add('user-1', PROJECT, wire('GPIO99')),
      ).resolves.toBeDefined();
    });
  });

  describe('manual bend points', () => {
    it('stores rounded coordinates', async () => {
      const created = await service.add('user-1', PROJECT, {
        ...wire(),
        waypoints: [{ x: 10.4, y: 20.6 }],
      });

      expect(created.waypoints).toEqual([{ x: 10, y: 21 }]);
    });

    it('replaces the whole set on update', async () => {
      const created = await service.add('user-1', PROJECT, {
        ...wire(),
        waypoints: [{ x: 10, y: 10 }],
      });

      const updated = await service.setWaypoints(PROJECT, created.id, [
        { x: 40, y: 40 },
        { x: 60, y: 40 },
      ]);

      expect(updated.waypoints).toEqual([
        { x: 40, y: 40 },
        { x: 60, y: 40 },
      ]);
    });

    it('resets to automatic routing with an empty array', async () => {
      const created = await service.add('user-1', PROJECT, {
        ...wire(),
        waypoints: [{ x: 10, y: 10 }],
      });

      const updated = await service.setWaypoints(PROJECT, created.id, []);

      expect(updated.waypoints).toEqual([]);
    });

    it('refuses a non-finite coordinate', async () => {
      await expect(
        service.add('user-1', PROJECT, {
          ...wire(),
          waypoints: [{ x: Number.NaN, y: 0 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an unreasonable number of bends', async () => {
      const tooMany = Array.from({ length: 25 }, (_, index) => ({
        x: index,
        y: index,
      }));

      await expect(
        service.add('user-1', PROJECT, { ...wire(), waypoints: tooMany }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to edit a connection from another project', async () => {
      const created = await service.add('user-1', PROJECT, wire());

      await expect(
        service.setWaypoints('another-project', created.id, []),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removal', () => {
    it('deletes a connection', async () => {
      const created = await service.add('user-1', PROJECT, wire());

      await service.remove(PROJECT, created.id);

      await expect(connections.count(PROJECT)).resolves.toBe(0);
    });

    it('refuses to delete one from another project', async () => {
      const created = await service.add('user-1', PROJECT, wire());

      await expect(
        service.remove('another-project', created.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
