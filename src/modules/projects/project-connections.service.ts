import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { LIMIT_KEYS, isUnlimited } from '../billing/entitlement';
import { EntitlementService } from '../billing/entitlement.service';
import {
  CreateConnectionInput,
  ProjectConnection,
  ProjectConnectionRepository,
} from './project.repository';

/** Bends beyond this are noise, and an unbounded array is a storage risk. */
const MAX_WAYPOINTS = 24;

@Injectable()
export class ProjectConnectionsService {
  constructor(
    private readonly connections: ProjectConnectionRepository,
    private readonly entitlements: EntitlementService,
  ) {}

  list(projectId: string): Promise<ProjectConnection[]> {
    return this.connections.list(projectId);
  }

  async add(
    userId: string,
    projectId: string,
    input: CreateConnectionInput,
  ): Promise<ProjectConnection> {
    if (
      input.from.componentId === input.to.componentId &&
      input.from.pinId === input.to.pinId
    ) {
      throw new BadRequestException({
        code: 'CONNECTION_SELF_LOOP',
        message: 'A pin cannot be connected to itself',
      });
    }

    // Both endpoints must live in this project. Without this a caller could
    // wire in a component id belonging to someone else's project.
    const belong = await this.connections.endpointsBelongToProject(projectId, [
      input.from.componentId,
      input.to.componentId,
    ]);
    if (!belong) {
      throw new NotFoundException({
        code: 'COMPONENT_NOT_FOUND',
        message: 'Component not found in this project',
      });
    }

    await this.assertWithinConnectionLimit(userId, projectId);

    return this.connections.create(projectId, {
      ...input,
      waypoints: normaliseWaypoints(input.waypoints),
    });
  }

  /** Replaces the manual bends. An empty array resets to automatic routing. */
  async setWaypoints(
    projectId: string,
    connectionId: string,
    waypoints: { x: number; y: number }[],
  ): Promise<ProjectConnection> {
    const updated = await this.connections.updateWaypoints(
      projectId,
      connectionId,
      normaliseWaypoints(waypoints),
    );

    if (!updated) {
      throw new NotFoundException({
        code: 'CONNECTION_NOT_FOUND',
        message: 'Connection not found in this project',
      });
    }

    return updated;
  }

  async remove(projectId: string, connectionId: string): Promise<void> {
    const removed = await this.connections.delete(projectId, connectionId);

    if (!removed) {
      throw new NotFoundException({
        code: 'CONNECTION_NOT_FOUND',
        message: 'Connection not found in this project',
      });
    }
  }

  private async assertWithinConnectionLimit(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const plan = await this.entitlements.planFor(userId);
    const limit = this.entitlements.limitOf(
      plan,
      LIMIT_KEYS.maxConnectionsPerProject,
    );
    if (isUnlimited(limit)) return;

    const used = await this.connections.count(projectId);
    if (used < limit) return;

    throw new ConflictException({
      code: 'CONNECTION_LIMIT_REACHED',
      message: `Your ${plan.name} plan supports up to ${limit} connections per project.`,
      limit,
      used,
      planCode: plan.code,
    });
  }
}

function normaliseWaypoints(
  waypoints: { x: number; y: number }[] | undefined,
): { x: number; y: number }[] {
  if (!waypoints?.length) return [];

  if (waypoints.length > MAX_WAYPOINTS) {
    throw new BadRequestException({
      code: 'TOO_MANY_WAYPOINTS',
      message: `A connection is limited to ${MAX_WAYPOINTS} bend points`,
    });
  }

  return waypoints.map((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new BadRequestException({
        code: 'INVALID_WAYPOINT',
        message: 'Bend points must be finite coordinates',
      });
    }
    // Rounded: sub-pixel precision in a stored bend is noise, and it keeps the
    // JSON small for wires with many bends.
    return { x: Math.round(point.x), y: Math.round(point.y) };
  });
}
