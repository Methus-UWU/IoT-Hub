import type { ProjectComponentsService } from '../projects/project-components.service';
import type { ProjectComponent } from '../projects/project.repository';
import {
  DashboardRepository,
  DashboardTemplate,
  DashboardTemplateRepository,
  DashboardTemplateVersion,
  DashboardWrite,
  Datastream,
  DatastreamInput,
  StoredDashboard,
  TemplateContent,
  TemplateMetadata,
} from './dashboard.repository';

function toDatastream(row: Datastream & { projectId: string }): Datastream {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    dataType: row.dataType,
    unit: row.unit,
    min: row.min,
    max: row.max,
    source: row.source,
    componentId: row.componentId,
  };
}

/** In-memory repositories for the dashboards specs. */
export class FakeDashboardRepository extends DashboardRepository {
  readonly dashboards = new Map<string, StoredDashboard>();
  readonly datastreams = new Map<string, Datastream & { projectId: string }>();
  private sequence = 0;

  find(projectId: string): Promise<StoredDashboard | null> {
    return Promise.resolve(this.dashboards.get(projectId) ?? null);
  }

  create(
    projectId: string,
    input: DashboardWrite,
  ): Promise<StoredDashboard | null> {
    if (this.dashboards.has(projectId)) return Promise.resolve(null);
    const stored = this.toStored(`dash-${++this.sequence}`, 1, input);
    this.dashboards.set(projectId, stored);
    return Promise.resolve(stored);
  }

  updateIfVersionMatches(
    projectId: string,
    expectedVersion: number,
    input: DashboardWrite,
  ): Promise<StoredDashboard | null> {
    const current = this.dashboards.get(projectId);
    if (!current || current.version !== expectedVersion)
      return Promise.resolve(null);
    const stored = this.toStored(current.id, current.version + 1, {
      templateId: current.templateId,
      templateVersion: current.templateVersion,
      ...input,
    });
    this.dashboards.set(projectId, stored);
    return Promise.resolve(stored);
  }

  async writeWithDatastreams(
    projectId: string,
    expectedVersion: number | null,
    input: DashboardWrite,
    datastreams: readonly DatastreamInput[],
  ): Promise<StoredDashboard | null> {
    const stored =
      expectedVersion === null
        ? await this.create(projectId, input)
        : await this.updateIfVersionMatches(projectId, expectedVersion, input);
    if (!stored) return null;
    for (const stream of datastreams)
      await this.createDatastream(projectId, stream);
    return stored;
  }

  listDatastreams(projectId: string): Promise<Datastream[]> {
    return Promise.resolve(
      [...this.datastreams.values()]
        .filter((row) => row.projectId === projectId)
        .map(toDatastream),
    );
  }

  createDatastream(
    projectId: string,
    input: DatastreamInput,
  ): Promise<Datastream | null> {
    const taken = [...this.datastreams.values()].some(
      (row) => row.projectId === projectId && row.key === input.key,
    );
    if (taken) return Promise.resolve(null);
    const row = { id: `stream-${++this.sequence}`, projectId, ...input };
    this.datastreams.set(row.id, row);
    return Promise.resolve(toDatastream(row));
  }

  updateDatastream(
    projectId: string,
    datastreamId: string,
    input: DatastreamInput,
  ): Promise<Datastream | null | 'taken'> {
    const row = this.datastreams.get(datastreamId);
    if (!row || row.projectId !== projectId) return Promise.resolve(null);
    const taken = [...this.datastreams.values()].some(
      (other) =>
        other.projectId === projectId &&
        other.key === input.key &&
        other.id !== row.id,
    );
    if (taken) return Promise.resolve('taken');
    const updated = { ...row, ...input };
    this.datastreams.set(datastreamId, updated);
    return Promise.resolve(toDatastream(updated));
  }

  deleteDatastream(projectId: string, datastreamId: string): Promise<boolean> {
    const row = this.datastreams.get(datastreamId);
    if (!row || row.projectId !== projectId) return Promise.resolve(false);
    return Promise.resolve(this.datastreams.delete(datastreamId));
  }

  private toStored(
    id: string,
    version: number,
    input: DashboardWrite,
  ): StoredDashboard {
    return {
      id,
      name: input.name,
      document: structuredClone(input.document),
      version,
      templateId: input.templateId ?? null,
      templateVersion: input.templateVersion ?? null,
      updatedAt: new Date(),
    };
  }
}

export class FakeTemplateRepository extends DashboardTemplateRepository {
  readonly templates = new Map<string, DashboardTemplate>();
  readonly versions = new Map<string, DashboardTemplateVersion>();
  private sequence = 0;

  listVisible(
    workspaceId: string,
    userId: string,
  ): Promise<DashboardTemplate[]> {
    return Promise.resolve(
      [...this.templates.values()].filter(
        (template) =>
          template.workspaceId === workspaceId &&
          (template.visibility === 'workspace' ||
            template.createdBy === userId),
      ),
    );
  }

  find(
    workspaceId: string,
    templateId: string,
  ): Promise<DashboardTemplate | null> {
    const template = this.templates.get(templateId);
    return Promise.resolve(
      template?.workspaceId === workspaceId ? template : null,
    );
  }

  findVersion(
    templateId: string,
    version: number,
  ): Promise<DashboardTemplateVersion | null> {
    return Promise.resolve(
      this.versions.get(`${templateId}:${version}`) ?? null,
    );
  }

  create(
    workspaceId: string,
    createdBy: string,
    metadata: TemplateMetadata,
    content: TemplateContent,
  ): Promise<DashboardTemplate> {
    const template: DashboardTemplate = {
      id: `template-${++this.sequence}`,
      workspaceId,
      createdBy,
      ...metadata,
      latestVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.templates.set(template.id, template);
    this.storeVersion(template.id, 1, content);
    return Promise.resolve(template);
  }

  addVersion(
    templateId: string,
    _createdBy: string,
    content: TemplateContent,
  ): Promise<DashboardTemplate> {
    const template = this.templates.get(templateId)!;
    const updated = { ...template, latestVersion: template.latestVersion + 1 };
    this.templates.set(templateId, updated);
    this.storeVersion(templateId, updated.latestVersion, content);
    return Promise.resolve(updated);
  }

  updateMetadata(
    templateId: string,
    metadata: Partial<TemplateMetadata>,
  ): Promise<DashboardTemplate> {
    const updated = { ...this.templates.get(templateId)!, ...metadata };
    this.templates.set(templateId, updated);
    return Promise.resolve(updated);
  }

  delete(templateId: string): Promise<void> {
    this.templates.delete(templateId);
    return Promise.resolve();
  }

  private storeVersion(
    templateId: string,
    version: number,
    content: TemplateContent,
  ) {
    this.versions.set(`${templateId}:${version}`, {
      templateId,
      version,
      document: structuredClone(content.document),
      datastreams: structuredClone(content.datastreams),
      createdAt: new Date(),
    });
  }
}

/** Only `list` is read by the dashboards services. */
export function fakeComponents(
  byProject: Record<string, Partial<ProjectComponent>[]>,
): ProjectComponentsService {
  return {
    list: (projectId: string) =>
      Promise.resolve(
        (byProject[projectId] ?? []).map((component, index) => ({
          id: `component-${index}`,
          definitionId: 'led',
          label: '',
          x: 0,
          y: 0,
          rotation: 0,
          state: {},
          ...component,
        })),
      ),
  } as unknown as ProjectComponentsService;
}
