import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { findBoardByIdOrName } from '../projects/board-catalog';
import { findDevice } from '../projects/catalog/device-catalog';
import { ProjectComponentsService } from '../projects/project-components.service';
import type { Project } from '../projects/project.repository';
import { satisfies, type WorkspaceRole } from '../workspaces/workspace-role';
import { parseDashboardDocument } from './dashboard-document';
import {
  DashboardTemplate,
  DashboardTemplateRepository,
  DatastreamTemplate,
  TemplateVisibility,
} from './dashboard.repository';
import { parseDatastreamTemplates } from './datastream-rules';
import { DashboardsService, DashboardView } from './dashboards.service';

export interface TemplateDetail extends DashboardTemplate {
  /** The version this detail shows, which may be older than `latestVersion`. */
  version: number;
  document: ReturnType<typeof parseDashboardDocument>;
  datastreams: DatastreamTemplate[];
  /** True when this caller may edit, version, or delete it. */
  editable: boolean;
}

export interface TemplateMetadataInput {
  name: string;
  description?: string;
  visibility?: TemplateVisibility;
}

/**
 * Reusable dashboards, in the spirit of Blynk templates.
 *
 * A template is a dashboard document plus the datastreams it reads, owned by a
 * workspace. Applying it copies both into a project: the project's dashboard can then
 * be rearranged for that one board without touching the template, and a new template
 * version never rewrites dashboards already made from an older one.
 *
 * Who may do what: any member who can see a template may apply it (an editor of the
 * target project); its creator or a workspace admin may change or delete it.
 */
@Injectable()
export class DashboardTemplatesService {
  constructor(
    private readonly templates: DashboardTemplateRepository,
    private readonly dashboards: DashboardsService,
    private readonly components: ProjectComponentsService,
  ) {}

  list(workspaceId: string, userId: string): Promise<DashboardTemplate[]> {
    return this.templates.listVisible(workspaceId, userId);
  }

  async get(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    templateId: string,
    version?: number,
  ): Promise<TemplateDetail> {
    const template = await this.requireVisible(workspaceId, userId, templateId);
    const stored = await this.templates.findVersion(
      template.id,
      version ?? template.latestVersion,
    );
    if (!stored) {
      throw new NotFoundException({
        code: 'TEMPLATE_VERSION_NOT_FOUND',
        message: 'Template version not found',
      });
    }
    return {
      ...template,
      version: stored.version,
      document: parseDashboardDocument(stored.document),
      datastreams: parseDatastreamTemplates(stored.datastreams),
      editable: this.canEdit(template, userId, role),
    };
  }

  /** "Save as template": snapshots the project's dashboard and datastreams. */
  async createFromProject(
    workspaceId: string,
    userId: string,
    project: Project,
    metadata: TemplateMetadataInput,
  ): Promise<DashboardTemplate> {
    const content = await this.snapshot(project.id);
    return this.templates.create(
      workspaceId,
      userId,
      {
        name: metadata.name,
        description: metadata.description ?? '',
        visibility: metadata.visibility ?? 'private',
        boardId: await this.boardIdOf(project),
      },
      content,
    );
  }

  /** Publishes the project's current dashboard as the template's next version. */
  async addVersionFromProject(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    templateId: string,
    project: Project,
  ): Promise<DashboardTemplate> {
    const template = await this.requireEditable(
      workspaceId,
      userId,
      role,
      templateId,
    );
    return this.templates.addVersion(
      template.id,
      userId,
      await this.snapshot(project.id),
    );
  }

  async updateMetadata(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    templateId: string,
    metadata: Partial<TemplateMetadataInput>,
  ): Promise<DashboardTemplate> {
    const template = await this.requireEditable(
      workspaceId,
      userId,
      role,
      templateId,
    );
    return this.templates.updateMetadata(template.id, metadata);
  }

  async duplicate(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    templateId: string,
  ): Promise<DashboardTemplate> {
    const source = await this.get(workspaceId, userId, role, templateId);
    return this.templates.create(
      workspaceId,
      userId,
      {
        name: `${source.name} (copy)`.slice(0, 80),
        description: source.description,
        boardId: source.boardId,
        // A copy starts private: sharing it is a separate, deliberate choice.
        visibility: 'private',
      },
      { document: source.document, datastreams: source.datastreams },
    );
  }

  async delete(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    templateId: string,
  ): Promise<void> {
    const template = await this.requireEditable(
      workspaceId,
      userId,
      role,
      templateId,
    );
    await this.templates.delete(template.id);
  }

  /**
   * Creates or replaces the project's dashboard from a template version.
   *
   * Widgets keep their datastream keys, which are created in the project when missing.
   * A widget's part is cleared: component ids belong to the project the template was
   * made from, and pointing at another project's part would be a binding to hardware
   * this one does not have. A board mismatch is reported, not refused — the layout may
   * still be useful — so the client can show it.
   */
  async apply(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    templateId: string,
    project: Project,
    options: { version?: number; expectedVersion: number | null },
  ): Promise<{ dashboard: DashboardView; warnings: string[] }> {
    const detail = await this.get(
      workspaceId,
      userId,
      role,
      templateId,
      options.version,
    );
    const document = {
      ...detail.document,
      widgets: detail.document.widgets.map((widget) => ({
        ...widget,
        deviceId: '',
      })),
    };
    const warnings: string[] = [];
    const boardId = await this.boardIdOf(project);
    if (detail.boardId && boardId && detail.boardId !== boardId) {
      warnings.push(
        `Template made for ${detail.boardId}; this project uses ${boardId}. Check pins and datastreams.`,
      );
    }
    const dashboard = await this.dashboards.replace(
      project.id,
      document,
      detail.datastreams.map((stream) => ({ ...stream, componentId: null })),
      { templateId: detail.id, templateVersion: detail.version },
      options.expectedVersion,
    );
    return { dashboard, warnings };
  }

  // ------------------------------------------------------------ internals

  private async snapshot(projectId: string) {
    const view = await this.dashboards.get(projectId);
    if (!view.document.widgets.length) {
      throw new UnprocessableEntityException({
        code: 'DASHBOARD_EMPTY',
        message: 'Add widgets to the dashboard before saving it as a template.',
      });
    }
    return {
      document: {
        ...view.document,
        widgets: view.document.widgets.map((widget) => ({
          ...widget,
          deviceId: '',
        })),
      },
      // A template carries no component: parts belong to one project.
      datastreams: view.datastreams.map((stream): DatastreamTemplate => ({
        key: stream.key,
        name: stream.name,
        dataType: stream.dataType,
        unit: stream.unit,
        min: stream.min,
        max: stream.max,
        source: stream.source,
      })),
    };
  }

  /** The board on the canvas, or the board the project was created for. */
  private async boardIdOf(project: Project): Promise<string> {
    const components = await this.components.list(project.id);
    const board = components.find(
      (component) => findDevice(component.definitionId)?.isBoard,
    );
    return (
      board?.definitionId ?? findBoardByIdOrName(project.board)?.id ?? 'unknown'
    );
  }

  private async requireVisible(
    workspaceId: string,
    userId: string,
    templateId: string,
  ): Promise<DashboardTemplate> {
    const template = await this.templates.find(workspaceId, templateId);
    // Someone else's private template is reported as absent, like a foreign project.
    if (
      !template ||
      (template.visibility === 'private' && template.createdBy !== userId)
    ) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: 'Template not found',
      });
    }
    return template;
  }

  private async requireEditable(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    templateId: string,
  ): Promise<DashboardTemplate> {
    const template = await this.requireVisible(workspaceId, userId, templateId);
    if (!this.canEdit(template, userId, role)) {
      throw new ForbiddenException({
        code: 'TEMPLATE_EDIT_FORBIDDEN',
        message:
          'Only the creator or a workspace admin can change this template.',
      });
    }
    return template;
  }

  private canEdit(
    template: DashboardTemplate,
    userId: string,
    role: WorkspaceRole,
  ): boolean {
    return (
      (template.createdBy === userId && satisfies(role, 'editor')) ||
      satisfies(role, 'admin')
    );
  }
}
