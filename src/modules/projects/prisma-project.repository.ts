import { ConflictException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateProjectInput,
  Project,
  ProjectFileContent,
  ProjectFileRepository,
  ProjectFileSummary,
  ProjectRepository,
  ProjectUsage,
} from './project.repository';

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

const FILE_SUMMARY_SELECT = {
  path: true,
  sizeBytes: true,
  contentHash: true,
  version: true,
  updatedAt: true,
} as const;

/** Prisma's code for a unique constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

@Injectable()
export class PrismaProjectRepository extends ProjectRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findById(projectId: string): Promise<Project | null> {
    return this.prisma.db.project.findUnique({
      where: { id: projectId },
      select: PROJECT_SELECT,
    });
  }

  listForWorkspace(workspaceId: string): Promise<Project[]> {
    return this.prisma.db.project.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      select: PROJECT_SELECT,
    });
  }

  async slugExists(workspaceId: string, slug: string): Promise<boolean> {
    const project = await this.prisma.db.project.findUnique({
      where: { workspaceId_slug: { workspaceId, slug } },
      select: { id: true },
    });
    return project !== null;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    try {
      return await this.prisma.db.project.create({
        data: {
          workspaceId: input.workspaceId,
          name: input.name,
          slug: input.slug,
          description: input.description ?? '',
          board: input.board ?? '',
          framework: input.framework ?? '',
        },
        select: PROJECT_SELECT,
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'PROJECT_SLUG_TAKEN',
          message: 'A project with that name already exists in this workspace',
        });
      }
      throw error;
    }
  }

  async delete(projectId: string): Promise<void> {
    await this.prisma.db.project.delete({ where: { id: projectId } });
  }
}

@Injectable()
export class PrismaProjectFileRepository extends ProjectFileRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  list(projectId: string): Promise<ProjectFileSummary[]> {
    return this.prisma.db.projectFile.findMany({
      where: { projectId },
      orderBy: { path: 'asc' },
      select: FILE_SUMMARY_SELECT,
    });
  }

  read(projectId: string, path: string): Promise<ProjectFileContent | null> {
    return this.prisma.db.projectFile.findUnique({
      where: { projectId_path: { projectId, path } },
      select: { ...FILE_SUMMARY_SELECT, content: true },
    });
  }

  async usage(projectId: string): Promise<ProjectUsage> {
    const result = await this.prisma.db.projectFile.aggregate({
      where: { projectId },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });

    return {
      fileCount: result._count._all,
      totalBytes: result._sum.sizeBytes ?? 0,
    };
  }

  async create(
    projectId: string,
    path: string,
    content: string,
    contentHash: string,
    sizeBytes: number,
  ): Promise<ProjectFileSummary> {
    try {
      return await this.prisma.db.projectFile.create({
        data: { projectId, path, content, contentHash, sizeBytes },
        select: FILE_SUMMARY_SELECT,
      });
    } catch (error: unknown) {
      // The unique index decides, not a prior existence check: two concurrent
      // creates of the same path must not both succeed.
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'FILE_ALREADY_EXISTS',
          message: 'A file already exists at that path',
        });
      }
      throw error;
    }
  }

  async updateIfVersionMatches(
    projectId: string,
    path: string,
    expectedVersion: number,
    content: string,
    contentHash: string,
    sizeBytes: number,
  ): Promise<ProjectFileSummary | null> {
    // updateMany with the version in the WHERE clause makes the check and the
    // write one atomic statement. Reading the version first and updating after
    // would leave a window in which another writer commits between the two.
    const result = await this.prisma.db.projectFile.updateMany({
      where: { projectId, path, version: expectedVersion },
      data: {
        content,
        contentHash,
        sizeBytes,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) return null;

    return this.prisma.db.projectFile.findUniqueOrThrow({
      where: { projectId_path: { projectId, path } },
      select: FILE_SUMMARY_SELECT,
    });
  }

  async delete(projectId: string, path: string): Promise<boolean> {
    const result = await this.prisma.db.projectFile.deleteMany({
      where: { projectId, path },
    });
    return result.count > 0;
  }

  async exists(projectId: string, path: string): Promise<boolean> {
    const file = await this.prisma.db.projectFile.findUnique({
      where: { projectId_path: { projectId, path } },
      select: { id: true },
    });
    return file !== null;
  }
}
