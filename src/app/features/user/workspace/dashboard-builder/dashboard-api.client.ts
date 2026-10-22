import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { WorkspaceContextService } from '../../../../core/services/workspace-context.service';
import { environment } from '../../../../../environments/environment';
import type { DashboardDocument } from './dashboard-builder.models';

export type DatastreamDataType = 'number' | 'boolean' | 'string';

export interface Datastream {
  id: string;
  key: string;
  name: string;
  dataType: DatastreamDataType;
  unit: string;
  min: number | null;
  max: number | null;
  source: string;
  componentId: string | null;
}

export type DatastreamInput = Omit<Datastream, 'id'>;

export interface DashboardView {
  /** 0 until the first save. */
  version: number;
  name: string;
  document: DashboardDocument;
  templateId: string | null;
  templateVersion: number | null;
  datastreams: Datastream[];
}

export type TemplateVisibility = 'private' | 'workspace';

export interface DashboardTemplateSummary {
  id: string;
  name: string;
  description: string;
  boardId: string;
  visibility: TemplateVisibility;
  latestVersion: number;
  createdBy: string | null;
  updatedAt: string;
}

export interface DashboardTemplateDetail extends DashboardTemplateSummary {
  version: number;
  document: DashboardDocument;
  datastreams: Omit<Datastream, 'id' | 'componentId'>[];
  editable: boolean;
}

/**
 * The dashboard API for one project, plus the workspace's templates.
 *
 * Workspace resolution lives here so the builder page deals in project ids only. The
 * server is the authority on every rule — bindings, versions, who may edit a template —
 * and its error codes come back as `HttpErrorResponse` for the page to word.
 */
@Service()
export class DashboardApiClient {
  private readonly http = inject(HttpClient);
  private readonly workspaces = inject(WorkspaceContextService);

  async get(projectId: string): Promise<DashboardView> {
    return firstValueFrom(
      this.http.get<DashboardView>(await this.projectUrl(projectId, 'dashboard')),
    );
  }

  async save(
    projectId: string,
    document: DashboardDocument,
    expectedVersion?: number,
  ): Promise<DashboardView> {
    return firstValueFrom(
      this.http.put<DashboardView>(await this.projectUrl(projectId, 'dashboard'), {
        document,
        ...(expectedVersion ? { expectedVersion } : {}),
      }),
    );
  }

  /** The project's parts, named the way the canvas names them. */
  async listComponents(projectId: string): Promise<{ id: string; label: string }[]> {
    const components = await firstValueFrom(
      this.http.get<{ id: string; label: string; definitionId: string }[]>(
        await this.projectUrl(projectId, 'components'),
      ),
    );
    return components.map((component) => ({
      id: component.id,
      label: component.label || component.definitionId,
    }));
  }

  async createDatastream(projectId: string, input: DatastreamInput): Promise<Datastream> {
    return firstValueFrom(
      this.http.post<Datastream>(await this.projectUrl(projectId, 'datastreams'), input),
    );
  }

  async deleteDatastream(projectId: string, datastreamId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<void>(
        await this.projectUrl(projectId, `datastreams/${encodeURIComponent(datastreamId)}`),
      ),
    );
  }

  async listTemplates(): Promise<DashboardTemplateSummary[]> {
    return firstValueFrom(this.http.get<DashboardTemplateSummary[]>(await this.templatesUrl()));
  }

  async getTemplate(templateId: string): Promise<DashboardTemplateDetail> {
    return firstValueFrom(
      this.http.get<DashboardTemplateDetail>(await this.templatesUrl(templateId)),
    );
  }

  async createTemplate(
    projectId: string,
    body: { name: string; description?: string; visibility: TemplateVisibility },
  ): Promise<DashboardTemplateSummary> {
    return firstValueFrom(
      this.http.post<DashboardTemplateSummary>(await this.templatesUrl(), { projectId, ...body }),
    );
  }

  async addTemplateVersion(
    templateId: string,
    projectId: string,
  ): Promise<DashboardTemplateSummary> {
    return firstValueFrom(
      this.http.post<DashboardTemplateSummary>(await this.templatesUrl(templateId, 'versions'), {
        projectId,
      }),
    );
  }

  async updateTemplate(
    templateId: string,
    body: Partial<{ name: string; description: string; visibility: TemplateVisibility }>,
  ): Promise<DashboardTemplateSummary> {
    return firstValueFrom(
      this.http.patch<DashboardTemplateSummary>(await this.templatesUrl(templateId), body),
    );
  }

  async duplicateTemplate(templateId: string): Promise<DashboardTemplateSummary> {
    return firstValueFrom(
      this.http.post<DashboardTemplateSummary>(
        await this.templatesUrl(templateId, 'duplicate'),
        {},
      ),
    );
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(await this.templatesUrl(templateId)));
  }

  async applyTemplate(
    projectId: string,
    templateId: string,
    expectedVersion: number,
  ): Promise<{ dashboard: DashboardView; warnings: string[] }> {
    return firstValueFrom(
      this.http.post<{ dashboard: DashboardView; warnings: string[] }>(
        await this.projectUrl(projectId, 'dashboard/apply-template'),
        { templateId, ...(expectedVersion ? { expectedVersion } : {}) },
      ),
    );
  }

  private async workspaceId(): Promise<string> {
    const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
    if (!workspace) throw new Error('No workspace is available for this account');
    return encodeURIComponent(workspace.id);
  }

  private async projectUrl(projectId: string, path: string): Promise<string> {
    return `${environment.apiUrl}workspaces/${await this.workspaceId()}/projects/${encodeURIComponent(
      projectId,
    )}/${path}`;
  }

  private async templatesUrl(templateId?: string, path?: string): Promise<string> {
    const base = `${environment.apiUrl}workspaces/${await this.workspaceId()}/dashboard-templates`;
    if (!templateId) return base;
    return `${base}/${encodeURIComponent(templateId)}${path ? `/${path}` : ''}`;
  }
}
