import { ConflictException, NotFoundException } from '@nestjs/common';

import { LIMIT_KEYS, PlanSummary, UNLIMITED } from '../billing/entitlement';
import { EntitlementService } from '../billing/entitlement.service';
import { AccountUsage, PlanRepository } from '../billing/plan.repository';
import { ProjectComponentsService } from './project-components.service';
import {
  CreateComponentInput,
  Project,
  ProjectComponent,
  ProjectComponentRepository,
  UpdateComponentInput,
} from './project.repository';

const PROJECT = 'project-1';
const OTHER_PROJECT = 'project-2';

class FakeComponentRepository extends ProjectComponentRepository {
  private readonly rows = new Map<
    string,
    ProjectComponent & { projectId: string }
  >();
  private sequence = 0;

  list(projectId: string): Promise<ProjectComponent[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.projectId === projectId),
    );
  }

  findById(
    projectId: string,
    componentId: string,
  ): Promise<ProjectComponent | null> {
    const row = this.rows.get(componentId);
    return Promise.resolve(row && row.projectId === projectId ? row : null);
  }

  count(projectId: string): Promise<number> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.projectId === projectId)
        .length,
    );
  }

  create(
    projectId: string,
    input: CreateComponentInput,
  ): Promise<ProjectComponent> {
    const row = {
      id: `component-${++this.sequence}`,
      projectId,
      definitionId: input.definitionId,
      label: input.label ?? '',
      x: input.x,
      y: input.y,
      rotation: input.rotation ?? 0,
      state: input.state ?? {},
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  update(
    projectId: string,
    componentId: string,
    input: UpdateComponentInput,
  ): Promise<ProjectComponent | null> {
    const row = this.rows.get(componentId);
    if (!row || row.projectId !== projectId) return Promise.resolve(null);

    Object.assign(row, input);
    return Promise.resolve(row);
  }

  delete(projectId: string, componentId: string): Promise<boolean> {
    const row = this.rows.get(componentId);
    if (!row || row.projectId !== projectId) return Promise.resolve(false);
    this.rows.delete(componentId);
    return Promise.resolve(true);
  }

  createProjectWithBoard(): Promise<{
    project: Project;
    component: ProjectComponent;
  }> {
    throw new Error('not used in these tests');
  }
}

class FakePlanRepository extends PlanRepository {
  plan: PlanSummary = {
    code: 'free',
    name: 'Free',
    limits: { [LIMIT_KEYS.maxComponentsPerProject]: 3 },
  };

  findPlanForUser(): Promise<PlanSummary> {
    return Promise.resolve(this.plan);
  }

  usageForUser(): Promise<AccountUsage> {
    return Promise.resolve({ projectCount: 0, storageBytes: 0 });
  }
}

describe('ProjectComponentsService', () => {
  let components: FakeComponentRepository;
  let plans: FakePlanRepository;
  let service: ProjectComponentsService;

  beforeEach(() => {
    components = new FakeComponentRepository();
    plans = new FakePlanRepository();
    service = new ProjectComponentsService(
      components,
      new EntitlementService(plans),
    );
  });

  describe('board placement', () => {
    it('accepts a known board', () => {
      expect(
        service.boardPlacement('esp32-devkit-v1', 'ESP32 DevKit V1'),
      ).toMatchObject({ definitionId: 'esp32-devkit-v1', rotation: 0 });
    });

    it('refuses an unknown board rather than storing it', () => {
      expect(() => service.boardPlacement('not-a-board', 'Nope')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('placement', () => {
    it('does not stack components added without a position', async () => {
      const first = await service.add('user-1', PROJECT, {
        definitionId: 'led',
      });
      const second = await service.add('user-1', PROJECT, {
        definitionId: 'led',
      });

      expect(`${first.x}:${first.y}`).not.toBe(`${second.x}:${second.y}`);
    });

    it('honours an explicit position', async () => {
      const placed = await service.add('user-1', PROJECT, {
        definitionId: 'led',
        x: 812,
        y: 344,
      });

      expect(placed).toMatchObject({ x: 812, y: 344 });
    });

    it('ignores positions taken in another project', async () => {
      // Occupying the origin elsewhere must not push this project's first
      // component off it.
      await service.add('user-1', OTHER_PROJECT, { definitionId: 'led' });
      const placed = await service.add('user-1', PROJECT, {
        definitionId: 'led',
      });

      expect(placed).toMatchObject({ x: 160, y: 160 });
    });
  });

  describe('component limit', () => {
    it('allows adding below the limit', async () => {
      await service.add('user-1', PROJECT, { definitionId: 'led' });
      await service.add('user-1', PROJECT, { definitionId: 'led' });

      await expect(
        service.add('user-1', PROJECT, { definitionId: 'led' }),
      ).resolves.toBeDefined();
    });

    it('refuses once the per-project ceiling is reached', async () => {
      for (let index = 0; index < 3; index++) {
        await service.add('user-1', PROJECT, { definitionId: 'led' });
      }

      await expect(
        service.add('user-1', PROJECT, { definitionId: 'led' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reports the ceiling so the client can offer an upgrade', async () => {
      for (let index = 0; index < 3; index++) {
        await service.add('user-1', PROJECT, { definitionId: 'led' });
      }

      const response = await service
        .add('user-1', PROJECT, { definitionId: 'led' })
        .catch((error: ConflictException) => error.getResponse());

      expect(response).toMatchObject({
        code: 'COMPONENT_LIMIT_REACHED',
        limit: 3,
        used: 3,
      });
    });

    it('counts each project separately', async () => {
      for (let index = 0; index < 3; index++) {
        await service.add('user-1', PROJECT, { definitionId: 'led' });
      }

      await expect(
        service.add('user-1', OTHER_PROJECT, { definitionId: 'led' }),
      ).resolves.toBeDefined();
    });

    it('never blocks an unlimited plan', async () => {
      plans.plan = {
        code: 'max',
        name: 'Max',
        limits: { [LIMIT_KEYS.maxComponentsPerProject]: UNLIMITED },
      };

      for (let index = 0; index < 25; index++) {
        await service.add('user-1', PROJECT, { definitionId: 'led' });
      }

      await expect(
        service.add('user-1', PROJECT, { definitionId: 'led' }),
      ).resolves.toBeDefined();
    });
  });

  describe('cross-project isolation', () => {
    it('refuses to update a component belonging to another project', async () => {
      const other = await service.add('user-1', OTHER_PROJECT, {
        definitionId: 'led',
      });

      await expect(
        service.update(PROJECT, other.id, { x: 0, y: 0 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to delete a component belonging to another project', async () => {
      const other = await service.add('user-1', OTHER_PROJECT, {
        definitionId: 'led',
      });

      await expect(service.remove(PROJECT, other.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('persists a moved position', async () => {
      const placed = await service.add('user-1', PROJECT, {
        definitionId: 'led',
      });

      await service.update(PROJECT, placed.id, { x: 500, y: 600 });

      const stored = await components.findById(PROJECT, placed.id);
      expect(stored).toMatchObject({ x: 500, y: 600 });
    });
  });
});
