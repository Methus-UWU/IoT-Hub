import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateConnectionInput,
  ProjectConnection,
  ProjectConnectionRepository,
} from './project.repository';

const CONNECTION_SELECT = {
  id: true,
  fromComponentId: true,
  fromPinId: true,
  toComponentId: true,
  toPinId: true,
  color: true,
  kind: true,
  waypoints: true,
} as const;

interface ConnectionRow {
  id: string;
  fromComponentId: string;
  fromPinId: string;
  toComponentId: string;
  toPinId: string;
  color: string;
  kind: string;
  waypoints: Prisma.JsonValue;
}

/** JSONB is untyped at rest, so only well-formed points survive the read. */
function toWaypoints(value: Prisma.JsonValue): { x: number; y: number }[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }
    const point = entry as Record<string, unknown>;
    return typeof point['x'] === 'number' && typeof point['y'] === 'number'
      ? [{ x: point['x'], y: point['y'] }]
      : [];
  });
}

function toConnection(row: ConnectionRow): ProjectConnection {
  return {
    id: row.id,
    from: { componentId: row.fromComponentId, pinId: row.fromPinId },
    to: { componentId: row.toComponentId, pinId: row.toPinId },
    color: row.color,
    kind: row.kind as ProjectConnection['kind'],
    waypoints: toWaypoints(row.waypoints),
  };
}

@Injectable()
export class PrismaProjectConnectionRepository extends ProjectConnectionRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(projectId: string): Promise<ProjectConnection[]> {
    const rows = await this.prisma.db.projectConnection.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: CONNECTION_SELECT,
    });
    return rows.map((row) => toConnection(row));
  }

  count(projectId: string): Promise<number> {
    return this.prisma.db.projectConnection.count({ where: { projectId } });
  }

  async create(
    projectId: string,
    input: CreateConnectionInput,
  ): Promise<ProjectConnection> {
    try {
      const row = await this.prisma.db.projectConnection.create({
        data: {
          projectId,
          fromComponentId: input.from.componentId,
          fromPinId: input.from.pinId,
          toComponentId: input.to.componentId,
          toPinId: input.to.pinId,
          color: input.color ?? '#2563eb',
          kind: input.kind ?? 'signal',
          waypoints: (input.waypoints ??
            []) as unknown as Prisma.InputJsonValue,
        },
        select: CONNECTION_SELECT,
      });
      return toConnection(row);
    } catch (error: unknown) {
      // The unique index treats A→B and B→A as the same electrical node, which
      // is what makes a duplicate wire impossible rather than merely unlikely.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'CONNECTION_ALREADY_EXISTS',
          message: 'These two pins are already connected',
        });
      }
      throw error;
    }
  }

  async updateWaypoints(
    projectId: string,
    connectionId: string,
    waypoints: { x: number; y: number }[],
  ): Promise<ProjectConnection | null> {
    const result = await this.prisma.db.projectConnection.updateMany({
      where: { id: connectionId, projectId },
      data: { waypoints: waypoints as unknown as Prisma.InputJsonValue },
    });

    if (result.count === 0) return null;

    const row = await this.prisma.db.projectConnection.findUniqueOrThrow({
      where: { id: connectionId },
      select: CONNECTION_SELECT,
    });
    return toConnection(row);
  }

  async delete(projectId: string, connectionId: string): Promise<boolean> {
    const result = await this.prisma.db.projectConnection.deleteMany({
      where: { id: connectionId, projectId },
    });
    return result.count > 0;
  }

  async endpointsBelongToProject(
    projectId: string,
    componentIds: readonly string[],
  ): Promise<boolean> {
    const unique = [...new Set(componentIds)];
    const found = await this.prisma.db.projectComponent.count({
      where: { projectId, id: { in: unique } },
    });
    return found === unique.length;
  }
}
