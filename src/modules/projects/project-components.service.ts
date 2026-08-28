import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { LIMIT_KEYS, isUnlimited } from '../billing/entitlement';
import { EntitlementService } from '../billing/entitlement.service';
import { isKnownBoard } from './board-catalog';
import {
  CreateComponentInput,
  ProjectComponent,
  ProjectComponentRepository,
  UpdateComponentInput,
} from './project.repository';

/**
 * Spacing used when the client does not choose a position.
 *
 * Placing every new component at the same coordinates would stack them, hiding
 * pins under one another and making the top one the only draggable part.
 */
const SPAWN_ORIGIN = { x: 160, y: 160 };
const SPAWN_STEP = 96;
const SPAWN_COLUMNS = 6;

/** A client may omit the position and let the server pick a free one. */
export type AddComponentRequest = Omit<CreateComponentInput, 'x' | 'y'> & {
  x?: number;
  y?: number;
};

@Injectable()
export class ProjectComponentsService {
  constructor(
    private readonly components: ProjectComponentRepository,
    private readonly entitlements: EntitlementService,
  ) {}

  list(projectId: string): Promise<ProjectComponent[]> {
    return this.components.list(projectId);
  }

  count(projectId: string): Promise<number> {
    return this.components.count(projectId);
  }

  /**
   * Adds a component, refusing once the plan's per-project ceiling is reached.
   *
   * The check runs before the write and throws, so a caller cannot add past the
   * limit by ignoring a return value.
   */
  async add(
    userId: string,
    projectId: string,
    input: AddComponentRequest,
  ): Promise<ProjectComponent> {
    await this.assertWithinComponentLimit(userId, projectId);

    const position =
      input.x !== undefined && input.y !== undefined
        ? { x: input.x, y: input.y }
        : await this.nextFreePosition(projectId);

    return this.components.create(projectId, { ...input, ...position });
  }

  async update(
    projectId: string,
    componentId: string,
    input: UpdateComponentInput,
  ): Promise<ProjectComponent> {
    const updated = await this.components.update(projectId, componentId, input);

    if (!updated) {
      throw new NotFoundException({
        code: 'COMPONENT_NOT_FOUND',
        message: 'Component not found in this project',
      });
    }

    return updated;
  }

  async remove(projectId: string, componentId: string): Promise<void> {
    const removed = await this.components.delete(projectId, componentId);

    if (!removed) {
      throw new NotFoundException({
        code: 'COMPONENT_NOT_FOUND',
        message: 'Component not found in this project',
      });
    }
  }

  /** The board that a project is created with, placed as its first component. */
  boardPlacement(definitionId: string, label: string): CreateComponentInput {
    if (!isKnownBoard(definitionId)) {
      throw new NotFoundException({
        code: 'BOARD_NOT_FOUND',
        message: 'Unknown board definition',
      });
    }

    return {
      definitionId,
      label,
      x: SPAWN_ORIGIN.x,
      y: SPAWN_ORIGIN.y,
      rotation: 0,
      state: {},
    };
  }

  async assertWithinComponentLimit(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const plan = await this.entitlements.planFor(userId);
    const limit = this.entitlements.limitOf(
      plan,
      LIMIT_KEYS.maxComponentsPerProject,
    );
    if (isUnlimited(limit)) return;

    const used = await this.components.count(projectId);
    if (used < limit) return;

    throw new ConflictException({
      code: 'COMPONENT_LIMIT_REACHED',
      message: `Your ${plan.name} plan supports up to ${limit} devices per project.`,
      limit,
      used,
      planCode: plan.code,
    });
  }

  /**
   * Finds a spot that is not already occupied, walking a grid outward.
   *
   * Only exact-cell collisions are avoided; the client is free to place a
   * component anywhere it likes, including deliberately overlapping. This exists
   * so that clicking a component in the library repeatedly does not bury each new
   * one under the last.
   */
  private async nextFreePosition(
    projectId: string,
  ): Promise<{ x: number; y: number }> {
    const existing = await this.components.list(projectId);
    const taken = new Set(
      existing.map(
        (component) => `${Math.round(component.x)}:${Math.round(component.y)}`,
      ),
    );

    for (let index = 0; index < 400; index++) {
      const x = SPAWN_ORIGIN.x + (index % SPAWN_COLUMNS) * SPAWN_STEP;
      const y = SPAWN_ORIGIN.y + Math.floor(index / SPAWN_COLUMNS) * SPAWN_STEP;
      if (!taken.has(`${x}:${y}`)) return { x, y };
    }

    return SPAWN_ORIGIN;
  }
}
