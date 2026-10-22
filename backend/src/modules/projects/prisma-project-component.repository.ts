import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateComponentInput,
  CreateFileInput,
  CreateProjectInput,
  Project,
  ProjectComponent,
  ProjectComponentRepository,
  UpdateComponentInput,
} from './project.repository';

const COMPONENT_SELECT = {
  id: true,
  definitionId: true,
  label: true,
  x: true,
  y: true,
  rotation: true,
  state: true,
} as const;

const PROJECT_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  slug: true,
  description: true,
  board: true,
  framework: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface ComponentRow {
  id: string;
  definitionId: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  state: Prisma.JsonValue;
}

/** JSONB can legally hold a scalar or an array; only an object is a state map. */
function toState(value: Prisma.JsonValue): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function toComponent(row: ComponentRow): ProjectComponent {
  return {
    id: row.id,
    definitionId: row.definitionId,
    label: row.label,
    x: row.x,
    y: row.y,
    rotation: row.rotation,
    state: toState(row.state),
  };
}

@Injectable()
export class PrismaProjectComponentRepository extends ProjectComponentRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(projectId: string): Promise<ProjectComponent[]> {
    const rows = await this.prisma.db.projectComponent.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: COMPONENT_SELECT,
    });
    return rows.map((row) => toComponent(row));
  }

  async findById(
    projectId: string,
    componentId: string,
  ): Promise<ProjectComponent | null> {
    const row = await this.prisma.db.projectComponent.findFirst({
      where: { id: componentId, projectId },
      select: COMPONENT_SELECT,
    });
    return row ? toComponent(row) : null;
  }

  count(projectId: string): Promise<number> {
    return this.prisma.db.projectComponent.count({ where: { projectId } });
  }

  countByDefinitionIds(
    projectId: string,
    definitionIds: readonly string[],
  ): Promise<number> {
    return this.prisma.db.projectComponent.count({
      where: { projectId, definitionId: { in: [...definitionIds] } },
    });
  }

  async create(
    projectId: string,
    input: CreateComponentInput,
  ): Promise<ProjectComponent> {
    const row = await this.prisma.db.projectComponent.create({
      data: {
        projectId,
        definitionId: input.definitionId,
        label: input.label ?? '',
        x: input.x,
        y: input.y,
        rotation: input.rotation ?? 0,
        state: (input.state ?? {}) as Prisma.InputJsonValue,
      },
      select: COMPONENT_SELECT,
    });
    return toComponent(row);
  }

  async update(
    projectId: string,
    componentId: string,
    input: UpdateComponentInput,
  ): Promise<ProjectComponent | null> {
    // Scoped by projectId in the WHERE clause, so a component id from another
    // project cannot be updated by guessing it.
    const result = await this.prisma.db.projectComponent.updateMany({
      where: { id: componentId, projectId },
      data: {
        ...(input.definitionId !== undefined
          ? { definitionId: input.definitionId }
          : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.x !== undefined ? { x: input.x } : {}),
        ...(input.y !== undefined ? { y: input.y } : {}),
        ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
        ...(input.state !== undefined
          ? { state: input.state as Prisma.InputJsonValue }
          : {}),
      },
    });

    if (result.count === 0) return null;
    return this.findById(projectId, componentId);
  }

  async delete(projectId: string, componentId: string): Promise<boolean> {
    const result = await this.prisma.db.projectComponent.deleteMany({
      where: { id: componentId, projectId },
    });
    return result.count > 0;
  }

  async createProjectWithBoard(
    project: CreateProjectInput,
    board: CreateComponentInput,
    devices: readonly CreateComponentInput[] = [],
    files: readonly CreateFileInput[] = [],
  ): Promise<{ project: Project; components: ProjectComponent[] }> {
    try {
      // Nested write: Prisma runs all of it in one transaction, so a project can
      // never exist without the board and starter files chosen for it.
      const created = await this.prisma.db.project.create({
        data: {
          workspaceId: project.workspaceId,
          name: project.name,
          slug: project.slug,
          description: project.description ?? '',
          board: project.board ?? '',
          framework: project.framework ?? '',
          components: {
            create: [board, ...devices].map((component) => ({
              definitionId: component.definitionId,
              label: component.label ?? '',
              x: component.x,
              y: component.y,
              rotation: component.rotation ?? 0,
              state: (component.state ?? {}) as Prisma.InputJsonValue,
            })),
          },
          files: {
            create: files.map((file) => ({
              path: file.path,
              content: file.content,
              contentHash: file.contentHash,
              sizeBytes: file.sizeBytes,
            })),
          },
        },
        select: { ...PROJECT_SELECT, components: { select: COMPONENT_SELECT } },
      });

      return {
        project: {
          id: created.id,
          workspaceId: created.workspaceId,
          name: created.name,
          slug: created.slug,
          description: created.description,
          board: created.board,
          framework: created.framework,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        },
        components: created.components.map(toComponent),
      };
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'PROJECT_SLUG_TAKEN',
          message: 'A project with that name already exists in this workspace',
        });
      }
      throw error;
    }
  }
}
