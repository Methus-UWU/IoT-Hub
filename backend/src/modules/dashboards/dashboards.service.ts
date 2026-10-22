import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { ProjectComponentsService } from '../projects/project-components.service';
import {
  DashboardDocument,
  DashboardDocumentError,
  emptyDashboard,
  parseDashboardDocument,
} from './dashboard-document';
import {
  DashboardRepository,
  Datastream,
  DatastreamInput,
  StoredDashboard,
} from './dashboard.repository';

export const MAX_DATASTREAMS = 64;

export interface DashboardView {
  /** 0 until the first save: the client creates by omitting `expectedVersion`. */
  version: number;
  name: string;
  document: DashboardDocument;
  templateId: string | null;
  templateVersion: number | null;
  datastreams: Datastream[];
}

/**
 * A project's dashboard and the datastreams its widgets bind to.
 *
 * Every write is checked against the project as it is: a widget may only name a
 * datastream the project has and a component the project contains. That is what keeps
 * a dashboard — the user's, a template's, or one the assistant proposed — from
 * showing data for hardware that is not there.
 */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly dashboards: DashboardRepository,
    private readonly components: ProjectComponentsService,
  ) {}

  async get(projectId: string): Promise<DashboardView> {
    const [stored, datastreams] = await Promise.all([
      this.dashboards.find(projectId),
      this.dashboards.listDatastreams(projectId),
    ]);
    return this.view(stored, datastreams);
  }

  async save(
    projectId: string,
    rawDocument: unknown,
    expectedVersion?: number,
  ): Promise<DashboardView> {
    const document = this.parse(rawDocument);
    const datastreams = await this.dashboards.listDatastreams(projectId);
    await this.requireBindings(projectId, document, datastreams);

    const input = { name: document.name, document };
    const stored =
      expectedVersion === undefined
        ? await this.dashboards.create(projectId, input)
        : await this.dashboards.updateIfVersionMatches(
            projectId,
            expectedVersion,
            input,
          );
    if (!stored) throw await this.versionConflict(projectId, expectedVersion);
    return this.view(stored, datastreams);
  }

  /**
   * Writes a dashboard together with datastreams it needs, as one transaction. Used to
   * apply a template or an accepted assistant proposal.
   */
  async replace(
    projectId: string,
    rawDocument: unknown,
    datastreams: readonly DatastreamInput[],
    origin: { templateId: string | null; templateVersion: number | null },
    expectedVersion: number | null,
  ): Promise<DashboardView> {
    const document = this.parse(rawDocument);
    const current = await this.dashboards.listDatastreams(projectId);
    const known = new Set(current.map((stream) => stream.key));
    const added = datastreams.filter((stream) => !known.has(stream.key));
    if (current.length + added.length > MAX_DATASTREAMS) {
      throw new UnprocessableEntityException({
        code: 'DATASTREAM_LIMIT_REACHED',
        message: `A project holds at most ${MAX_DATASTREAMS} datastreams.`,
      });
    }
    await this.requireBindings(projectId, document, [...current, ...added]);

    const stored = await this.dashboards.writeWithDatastreams(
      projectId,
      expectedVersion,
      { name: document.name, document, ...origin },
      added,
    );
    if (!stored)
      throw await this.versionConflict(projectId, expectedVersion ?? undefined);
    return this.get(projectId);
  }

  // ------------------------------------------------------------ datastreams

  listDatastreams(projectId: string): Promise<Datastream[]> {
    return this.dashboards.listDatastreams(projectId);
  }

  async createDatastream(
    projectId: string,
    input: DatastreamInput,
  ): Promise<Datastream> {
    const existing = await this.dashboards.listDatastreams(projectId);
    if (existing.length >= MAX_DATASTREAMS) {
      throw new UnprocessableEntityException({
        code: 'DATASTREAM_LIMIT_REACHED',
        message: `A project holds at most ${MAX_DATASTREAMS} datastreams.`,
      });
    }
    await this.requireComponent(projectId, input.componentId);
    const created = await this.dashboards.createDatastream(projectId, input);
    if (!created) throw keyTaken(input.key);
    return created;
  }

  async updateDatastream(
    projectId: string,
    datastreamId: string,
    input: DatastreamInput,
  ): Promise<Datastream> {
    const [existing, stored] = await Promise.all([
      this.dashboards.listDatastreams(projectId),
      this.dashboards.find(projectId),
    ]);
    const current = existing.find((stream) => stream.id === datastreamId);
    if (!current) throw datastreamNotFound();
    if (current.key !== input.key) this.requireUnused(current.key, stored);
    await this.requireComponent(projectId, input.componentId);

    const updated = await this.dashboards.updateDatastream(
      projectId,
      datastreamId,
      input,
    );
    if (updated === 'taken') throw keyTaken(input.key);
    if (!updated) throw datastreamNotFound();
    return updated;
  }

  async deleteDatastream(
    projectId: string,
    datastreamId: string,
  ): Promise<void> {
    const [existing, stored] = await Promise.all([
      this.dashboards.listDatastreams(projectId),
      this.dashboards.find(projectId),
    ]);
    const current = existing.find((stream) => stream.id === datastreamId);
    if (!current) throw datastreamNotFound();
    this.requireUnused(current.key, stored);
    await this.dashboards.deleteDatastream(projectId, datastreamId);
  }

  // ------------------------------------------------------------ internals

  private parse(rawDocument: unknown): DashboardDocument {
    try {
      return parseDashboardDocument(rawDocument);
    } catch (error) {
      if (error instanceof DashboardDocumentError) {
        throw new UnprocessableEntityException({
          code: 'INVALID_DASHBOARD',
          message: 'The dashboard is not valid.',
          problems: error.problems.slice(0, 20),
        });
      }
      throw error;
    }
  }

  /** Refuses a widget bound to a datastream or a component this project does not have. */
  private async requireBindings(
    projectId: string,
    document: DashboardDocument,
    datastreams: readonly Pick<Datastream, 'key'>[],
  ): Promise<void> {
    const keys = new Set(datastreams.map((stream) => stream.key));
    const unknownStreams = document.widgets
      .filter((widget) => widget.datasource && !keys.has(widget.datasource))
      .map((widget) => widget.datasource);
    if (unknownStreams.length) {
      throw new UnprocessableEntityException({
        code: 'DASHBOARD_UNKNOWN_DATASTREAM',
        message:
          'A widget is bound to a datastream this project does not have.',
        datastreams: [...new Set(unknownStreams)],
      });
    }

    const deviceIds = document.widgets
      .map((widget) => widget.deviceId)
      .filter(Boolean);
    if (!deviceIds.length) return;
    const components = new Set(
      (await this.components.list(projectId)).map((component) => component.id),
    );
    const unknownDevices = deviceIds.filter((id) => !components.has(id));
    if (unknownDevices.length) {
      throw new UnprocessableEntityException({
        code: 'DASHBOARD_UNKNOWN_DEVICE',
        message: 'A widget names a part this project does not contain.',
        devices: [...new Set(unknownDevices)],
      });
    }
  }

  private async requireComponent(
    projectId: string,
    componentId: string | null,
  ): Promise<void> {
    if (!componentId) return;
    const components = await this.components.list(projectId);
    if (!components.some((component) => component.id === componentId)) {
      throw new UnprocessableEntityException({
        code: 'DATASTREAM_UNKNOWN_COMPONENT',
        message: 'The datastream names a part this project does not contain.',
      });
    }
  }

  private requireUnused(key: string, stored: StoredDashboard | null): void {
    const widgets = stored ? safeWidgets(stored.document) : [];
    if (widgets.some((widget) => widget.datasource === key)) {
      throw new ConflictException({
        code: 'DATASTREAM_IN_USE',
        message: `Widgets still read "${key}". Unbind them first.`,
      });
    }
  }

  private async versionConflict(projectId: string, expectedVersion?: number) {
    const current = await this.dashboards.find(projectId);
    return new ConflictException(
      expectedVersion === undefined
        ? {
            code: 'DASHBOARD_ALREADY_EXISTS',
            message:
              'This project already has a dashboard. Reload before saving.',
            currentVersion: current?.version ?? 0,
          }
        : {
            code: 'DASHBOARD_VERSION_CONFLICT',
            message:
              'The dashboard changed since you loaded it. Reload before saving.',
            currentVersion: current?.version ?? 0,
          },
    );
  }

  private view(
    stored: StoredDashboard | null,
    datastreams: Datastream[],
  ): DashboardView {
    if (!stored) {
      return {
        version: 0,
        name: 'Dashboard',
        document: emptyDashboard(),
        templateId: null,
        templateVersion: null,
        datastreams,
      };
    }
    let document: DashboardDocument;
    try {
      document = parseDashboardDocument(stored.document);
    } catch {
      // Stored documents went through the parser; this only guards a hand-edited row.
      document = emptyDashboard(stored.name);
    }
    return {
      version: stored.version,
      name: stored.name,
      document,
      templateId: stored.templateId,
      templateVersion: stored.templateVersion,
      datastreams,
    };
  }
}

function safeWidgets(document: unknown): { datasource: string }[] {
  try {
    return parseDashboardDocument(document).widgets;
  } catch {
    return [];
  }
}

function keyTaken(key: string) {
  return new ConflictException({
    code: 'DATASTREAM_KEY_TAKEN',
    message: `This project already has a datastream "${key}".`,
  });
}

function datastreamNotFound() {
  return new NotFoundException({
    code: 'DATASTREAM_NOT_FOUND',
    message: 'Datastream not found',
  });
}
