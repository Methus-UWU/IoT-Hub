import {
  ConflictException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { LIMIT_KEYS, isUnlimited } from '../billing/entitlement';
import { EntitlementService } from '../billing/entitlement.service';
import { BOARD_DEFINITIONS, isKnownBoard } from './board-catalog';
import { findDevice } from './catalog/device-catalog';
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
const MAX_BOARDS_PER_PROJECT = 1;
const BOARD_DEFINITION_IDS = BOARD_DEFINITIONS.map((board) => board.id);

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
    await this.assertWithinBoardLimit(projectId, input.definitionId);

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
    if (input.definitionId !== undefined) {
      await this.assertVariantChange(
        projectId,
        componentId,
        input.definitionId,
      );
    }

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
    const used = await this.components.count(projectId);
    await this.assertComponentCapacity(userId, used, 1);
  }

  /** Validates the complete selection before the project is committed. */
  async initialDevicePlacements(
    userId: string,
    deviceIds: readonly string[],
  ): Promise<CreateComponentInput[]> {
    const devices = deviceIds.map((id) => {
      const device = findDevice(id);
      if (!device || device.isBoard) {
        throw new BadRequestException({
          code: 'INVALID_INITIAL_DEVICE',
          message:
            'Choose peripherals from the catalog; select the board separately',
        });
      }
      return device;
    });
    await this.assertComponentCapacity(userId, 0, devices.length + 1);
    return devices.map((device, index) => ({
      definitionId: device.id,
      label: device.name,
      ...this.positionAt(index + 1),
      rotation: 0,
      state: {},
    }));
  }

  private async assertComponentCapacity(
    userId: string,
    used: number,
    adding: number,
  ): Promise<void> {
    const plan = await this.entitlements.planFor(userId);
    const limit = this.entitlements.limitOf(
      plan,
      LIMIT_KEYS.maxComponentsPerProject,
    );
    if (isUnlimited(limit)) return;

    if (used + adding <= limit) return;

    throw new ConflictException({
      code: 'COMPONENT_LIMIT_REACHED',
      message: `Your ${plan.name} plan supports up to ${limit} devices per project.`,
      limit,
      used,
      planCode: plan.code,
    });
  }

  /**
   * A peripheral may turn into another catalog peripheral in place — a
   * common-anode RGB LED into a common-cathode one — keeping its id and wires.
   * Boards never change this way: the board is chosen with the project and
   * counted against its own limit.
   */
  private async assertVariantChange(
    projectId: string,
    componentId: string,
    definitionId: string,
  ): Promise<void> {
    const current = await this.components.findById(projectId, componentId);
    if (!current) {
      throw new NotFoundException({
        code: 'COMPONENT_NOT_FOUND',
        message: 'Component not found in this project',
      });
    }

    const next = findDevice(definitionId);
    if (!next || next.isBoard || isKnownBoard(current.definitionId)) {
      throw new BadRequestException({
        code: 'INVALID_DEFINITION_CHANGE',
        message: 'Only a peripheral can change into another catalog peripheral',
      });
    }
  }

  private async assertWithinBoardLimit(
    projectId: string,
    definitionId: string,
  ): Promise<void> {
    if (!isKnownBoard(definitionId)) return;

    const used = await this.components.countByDefinitionIds(
      projectId,
      BOARD_DEFINITION_IDS,
    );
    if (used < MAX_BOARDS_PER_PROJECT) return;

    throw new ConflictException({
      code: 'BOARD_LIMIT_REACHED',
      message: `A project can contain up to ${MAX_BOARDS_PER_PROJECT} boards.`,
      limit: MAX_BOARDS_PER_PROJECT,
      used,
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
      const { x, y } = this.positionAt(index);
      if (!taken.has(`${x}:${y}`)) return { x, y };
    }

    return SPAWN_ORIGIN;
  }

  private positionAt(index: number): { x: number; y: number } {
    return {
      x: SPAWN_ORIGIN.x + (index % SPAWN_COLUMNS) * SPAWN_STEP,
      y: SPAWN_ORIGIN.y + Math.floor(index / SPAWN_COLUMNS) * SPAWN_STEP,
    };
  }
}
