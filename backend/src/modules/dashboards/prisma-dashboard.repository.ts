import { Injectable } from '@nestjs/common';

import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DashboardRepository,
  DashboardTemplate,
  DashboardTemplateRepository,
  DashboardTemplateVersion,
  DashboardWrite,
  Datastream,
  DatastreamDataType,
  DatastreamInput,
  StoredDashboard,
  TemplateContent,
  TemplateMetadata,
  TemplateVisibility,
} from './dashboard.repository';

const UNIQUE_VIOLATION = 'P2002';

type Tx = Prisma.TransactionClient;

const DASHBOARD_SELECT = {
  id: true,
  name: true,
  document: true,
  version: true,
  templateId: true,
  templateVersion: true,
  updatedAt: true,
} as const;

const DATASTREAM_SELECT = {
  id: true,
  key: true,
  name: true,
  dataType: true,
  unit: true,
  min: true,
  max: true,
  source: true,
  componentId: true,
} as const;

const TEMPLATE_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  boardId: true,
  visibility: true,
  latestVersion: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown })?.code === UNIQUE_VIOLATION;
}

/** The CHECK constraints guarantee these strings; the casts only restate them. */
function toDatastream(
  row: Omit<Datastream, 'dataType'> & { dataType: string },
): Datastream {
  return { ...row, dataType: row.dataType as DatastreamDataType };
}

function toTemplate(
  row: Omit<DashboardTemplate, 'visibility'> & { visibility: string },
) {
  return { ...row, visibility: row.visibility as TemplateVisibility };
}

function dashboardData(input: DashboardWrite) {
  return {
    name: input.name,
    document: input.document as Prisma.InputJsonValue,
    ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
    ...(input.templateVersion !== undefined
      ? { templateVersion: input.templateVersion }
      : {}),
  };
}

function datastreamData(input: DatastreamInput) {
  return {
    key: input.key,
    name: input.name,
    dataType: input.dataType,
    unit: input.unit,
    min: input.min,
    max: input.max,
    source: input.source,
    componentId: input.componentId,
  };
}

@Injectable()
export class PrismaDashboardRepository extends DashboardRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** Writes and the reads that follow them use the primary, never a lagging replica. */
  private get primary(): Pick<PrismaClient, '$transaction'> {
    return this.prisma.db as Pick<PrismaClient, '$transaction'>;
  }

  find(projectId: string): Promise<StoredDashboard | null> {
    return this.prisma.db.projectDashboard.findUnique({
      where: { projectId },
      select: DASHBOARD_SELECT,
    });
  }

  async create(
    projectId: string,
    input: DashboardWrite,
  ): Promise<StoredDashboard | null> {
    try {
      return await this.prisma.db.projectDashboard.create({
        data: { projectId, ...dashboardData(input) },
        select: DASHBOARD_SELECT,
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  updateIfVersionMatches(
    projectId: string,
    expectedVersion: number,
    input: DashboardWrite,
  ): Promise<StoredDashboard | null> {
    return this.primary.$transaction((tx) =>
      this.updateInTx(tx, projectId, expectedVersion, input),
    );
  }

  async writeWithDatastreams(
    projectId: string,
    expectedVersion: number | null,
    input: DashboardWrite,
    datastreams: readonly DatastreamInput[],
  ): Promise<StoredDashboard | null> {
    try {
      return await this.primary.$transaction(async (tx) => {
        const existing = await tx.projectDatastream.findMany({
          where: { projectId },
          select: { key: true },
        });
        const keys = new Set(existing.map((row) => row.key));
        const missing = datastreams.filter((stream) => !keys.has(stream.key));
        if (missing.length) {
          await tx.projectDatastream.createMany({
            data: missing.map((stream) => ({
              projectId,
              ...datastreamData(stream),
            })),
          });
        }
        if (expectedVersion === null) {
          return tx.projectDashboard.create({
            data: { projectId, ...dashboardData(input) },
            select: DASHBOARD_SELECT,
          });
        }
        const updated = await this.updateInTx(
          tx,
          projectId,
          expectedVersion,
          input,
        );
        // Undo the datastreams too: the caller's expectation failed as a whole.
        if (!updated) throw new StaleDashboard();
        return updated;
      });
    } catch (error) {
      if (error instanceof StaleDashboard || isUniqueViolation(error))
        return null;
      throw error;
    }
  }

  async listDatastreams(projectId: string): Promise<Datastream[]> {
    const rows = await this.prisma.db.projectDatastream.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: DATASTREAM_SELECT,
    });
    return rows.map(toDatastream);
  }

  async createDatastream(
    projectId: string,
    input: DatastreamInput,
  ): Promise<Datastream | null> {
    try {
      const row = await this.prisma.db.projectDatastream.create({
        data: { projectId, ...datastreamData(input) },
        select: DATASTREAM_SELECT,
      });
      return toDatastream(row);
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async updateDatastream(
    projectId: string,
    datastreamId: string,
    input: DatastreamInput,
  ): Promise<Datastream | null | 'taken'> {
    try {
      return await this.primary.$transaction(async (tx) => {
        // Scoped by project in the WHERE clause, so an id from another project
        // cannot be updated by guessing it.
        const result = await tx.projectDatastream.updateMany({
          where: { id: datastreamId, projectId },
          data: datastreamData(input),
        });
        if (result.count === 0) return null;
        const row = await tx.projectDatastream.findUniqueOrThrow({
          where: { id: datastreamId },
          select: DATASTREAM_SELECT,
        });
        return toDatastream(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'taken';
      throw error;
    }
  }

  async deleteDatastream(
    projectId: string,
    datastreamId: string,
  ): Promise<boolean> {
    const result = await this.prisma.db.projectDatastream.deleteMany({
      where: { id: datastreamId, projectId },
    });
    return result.count > 0;
  }

  private async updateInTx(
    tx: Tx,
    projectId: string,
    expectedVersion: number,
    input: DashboardWrite,
  ): Promise<StoredDashboard | null> {
    // The version in the WHERE clause makes the check and the write one statement.
    const result = await tx.projectDashboard.updateMany({
      where: { projectId, version: expectedVersion },
      data: { ...dashboardData(input), version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return tx.projectDashboard.findUniqueOrThrow({
      where: { projectId },
      select: DASHBOARD_SELECT,
    });
  }
}

class StaleDashboard extends Error {}

@Injectable()
export class PrismaDashboardTemplateRepository extends DashboardTemplateRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  private get primary(): Pick<PrismaClient, '$transaction'> {
    return this.prisma.db as Pick<PrismaClient, '$transaction'>;
  }

  async listVisible(
    workspaceId: string,
    userId: string,
  ): Promise<DashboardTemplate[]> {
    const rows = await this.prisma.db.dashboardTemplate.findMany({
      where: {
        workspaceId,
        OR: [{ visibility: 'workspace' }, { createdBy: userId }],
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: TEMPLATE_SELECT,
    });
    return rows.map(toTemplate);
  }

  async find(
    workspaceId: string,
    templateId: string,
  ): Promise<DashboardTemplate | null> {
    const row = await this.prisma.db.dashboardTemplate.findFirst({
      where: { id: templateId, workspaceId },
      select: TEMPLATE_SELECT,
    });
    return row ? toTemplate(row) : null;
  }

  findVersion(
    templateId: string,
    version: number,
  ): Promise<DashboardTemplateVersion | null> {
    return this.prisma.db.dashboardTemplateVersion.findUnique({
      where: { templateId_version: { templateId, version } },
      select: {
        templateId: true,
        version: true,
        document: true,
        datastreams: true,
        createdAt: true,
      },
    });
  }

  async create(
    workspaceId: string,
    createdBy: string,
    metadata: TemplateMetadata,
    content: TemplateContent,
  ): Promise<DashboardTemplate> {
    const row = await this.prisma.db.dashboardTemplate.create({
      data: {
        workspaceId,
        createdBy,
        ...metadata,
        latestVersion: 1,
        versions: {
          create: {
            version: 1,
            createdBy,
            document: content.document as Prisma.InputJsonValue,
            datastreams:
              content.datastreams as unknown as Prisma.InputJsonValue,
          },
        },
      },
      select: TEMPLATE_SELECT,
    });
    return toTemplate(row);
  }

  addVersion(
    templateId: string,
    createdBy: string,
    content: TemplateContent,
  ): Promise<DashboardTemplate> {
    return this.primary.$transaction(async (tx) => {
      // Incrementing first takes the row lock, so two editors cannot both claim the
      // same next version.
      const template = await tx.dashboardTemplate.update({
        where: { id: templateId },
        data: { latestVersion: { increment: 1 } },
        select: TEMPLATE_SELECT,
      });
      await tx.dashboardTemplateVersion.create({
        data: {
          templateId,
          version: template.latestVersion,
          createdBy,
          document: content.document as Prisma.InputJsonValue,
          datastreams: content.datastreams,
        },
      });
      return toTemplate(template);
    });
  }

  async updateMetadata(
    templateId: string,
    metadata: Partial<TemplateMetadata>,
  ): Promise<DashboardTemplate> {
    const row = await this.prisma.db.dashboardTemplate.update({
      where: { id: templateId },
      data: metadata,
      select: TEMPLATE_SELECT,
    });
    return toTemplate(row);
  }

  async delete(templateId: string): Promise<void> {
    await this.prisma.db.dashboardTemplate.delete({
      where: { id: templateId },
    });
  }
}
