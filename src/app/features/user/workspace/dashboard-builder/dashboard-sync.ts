import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

import { apiErrorCode, apiErrorMessage } from '../../../../core/models/api-error';
import { DashboardViewCache } from './dashboard-view.cache';
import { DashboardApiClient, DashboardView, Datastream } from './dashboard-api.client';
import { DashboardDocument, DashboardWidget, cloneWidgets } from './dashboard-builder.models';

/** The dashboard as the builder edits it; ids and schema are filled in on save. */
export interface DashboardContent {
  name: string;
  deviceScope: string;
  dateRange: string;
  widgets: DashboardWidget[];
}

export type SaveOutcome = 'saved' | 'unchanged' | 'conflict' | 'rejected' | 'offline';

/** Where the builder kept dashboards before they lived on the server. */
const LEGACY_STORAGE_KEY = (projectId: string) => `iot-hub:dashboard-builder:${projectId}:v1`;

/**
 * Loads and saves one project's dashboard against the API.
 *
 * Saves run one at a time and each states the version the previous one produced, so an
 * autosave and a manual save cannot race each other into a version conflict. A save of
 * content identical to what the server already holds is skipped. Provided per builder
 * page: the version it tracks belongs to the page's open project.
 */
@Injectable()
export class DashboardSync {
  private readonly api = inject(DashboardApiClient);
  private readonly document = inject(DOCUMENT);
  private readonly cache = inject(DashboardViewCache);
  private projectId: string | null = null;
  private version = 0;
  private savedJson = '';
  private queue: Promise<unknown> = Promise.resolve();

  readonly datastreams = signal<Datastream[]>([]);
  readonly templateId = signal<string | null>(null);
  readonly templateVersion = signal<number | null>(null);
  /** The server's message for the last refused save, for the page to show. */
  readonly lastProblem = signal('');

  /**
   * Fetches the project's dashboard. A project that never saved one on the server but
   * has a dashboard from the browser-only era gets it uploaded once, with bindings the
   * project cannot honour cleared rather than the whole dashboard refused.
   */
  async load(projectId: string): Promise<DashboardContent> {
    this.projectId = projectId;
    let view = await this.api.get(projectId);
    if (view.version === 0) view = (await this.importLegacy(projectId, view)) ?? view;
    return this.accept(view);
  }

  /** Replaces the tracked state with a view another call produced, e.g. a template apply. */
  accept(view: DashboardView): DashboardContent {
    if (this.projectId) this.cache.setView(this.projectId, view);
    this.version = view.version;
    this.datastreams.set(view.datastreams);
    this.templateId.set(view.templateId);
    this.templateVersion.set(view.templateVersion);
    const content = toContent(view.document);
    this.savedJson = JSON.stringify(content);
    return content;
  }

  /** The view this session last saw for the project, to draw before the server answers. */
  cachedView(projectId: string): DashboardView | undefined {
    return this.cache.view(projectId);
  }

  /** Tracks a cached view as the saved state, exactly as `load` would. */
  adopt(projectId: string, view: DashboardView): DashboardContent {
    this.projectId = projectId;
    return this.accept(view);
  }

  /** The server's current view, without changing what is tracked. */
  fetchLatest(projectId: string): Promise<DashboardView> {
    return this.api.get(projectId);
  }

  get currentVersion(): number {
    return this.version;
  }

  isSaved(content: DashboardContent): boolean {
    return JSON.stringify(content) === this.savedJson;
  }

  save(content: DashboardContent): Promise<SaveOutcome> {
    const projectId = this.projectId;
    if (!projectId) return Promise.resolve('rejected');
    const run = this.queue.then(() => this.write(projectId, content));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Bindings to datastreams the project lacks, cleared; used for starter and imported content. */
  unbindUnknown(widgets: readonly DashboardWidget[]): DashboardWidget[] {
    const keys = new Set(this.datastreams().map((stream) => stream.key));
    const components = new Set(
      this.datastreams()
        .map((stream) => stream.componentId)
        .filter(Boolean),
    );
    return cloneWidgets(widgets).map((widget) => ({
      ...widget,
      datasource: keys.has(widget.datasource) ? widget.datasource : '',
      deviceId: components.has(widget.deviceId) ? widget.deviceId : '',
    }));
  }

  private async write(projectId: string, content: DashboardContent): Promise<SaveOutcome> {
    if (projectId !== this.projectId) return 'rejected';
    const json = JSON.stringify(content);
    if (json === this.savedJson) return 'unchanged';
    try {
      const view = await this.api.save(projectId, toDocument(projectId, content), this.version);
      if (projectId !== this.projectId) return 'rejected';
      this.version = view.version;
      this.datastreams.set(view.datastreams);
      this.cache.setView(projectId, view);
      this.savedJson = json;
      this.lastProblem.set('');
      return 'saved';
    } catch (error: unknown) {
      if (!(error instanceof HttpErrorResponse) || error.status === 0) return 'offline';
      const code = apiErrorCode(error);
      this.lastProblem.set(apiErrorMessage(error) ?? '');
      return code === 'DASHBOARD_VERSION_CONFLICT' || code === 'DASHBOARD_ALREADY_EXISTS'
        ? 'conflict'
        : 'rejected';
    }
  }

  private async importLegacy(
    projectId: string,
    view: DashboardView,
  ): Promise<DashboardView | null> {
    const storage = this.document.defaultView?.localStorage;
    let raw: string | null = null;
    try {
      raw = storage?.getItem(LEGACY_STORAGE_KEY(projectId)) ?? null;
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const legacy = JSON.parse(raw) as Partial<DashboardDocument>;
      if (!Array.isArray(legacy.widgets) || legacy.widgets.length === 0) return null;
      this.datastreams.set(view.datastreams);
      const content: DashboardContent = {
        name: typeof legacy.name === 'string' ? legacy.name : view.name,
        deviceScope: typeof legacy.deviceScope === 'string' ? legacy.deviceScope : '',
        dateRange: typeof legacy.dateRange === 'string' ? legacy.dateRange : '24h',
        widgets: this.unbindUnknown(legacy.widgets),
      };
      const saved = await this.api.save(projectId, toDocument(projectId, content));
      storage?.removeItem(LEGACY_STORAGE_KEY(projectId));
      return saved;
    } catch {
      // The old copy stays in the browser; the server dashboard simply starts empty.
      return null;
    }
  }
}

/** The one place defaults are filled in, so a freshly loaded dashboard counts as saved. */
function toContent(document: DashboardDocument): DashboardContent {
  return {
    name: document.name || 'Dashboard',
    deviceScope: document.deviceScope || 'All devices',
    dateRange: document.dateRange || '24h',
    widgets: cloneWidgets(document.widgets),
  };
}

function toDocument(projectId: string, content: DashboardContent): DashboardDocument {
  return {
    schemaVersion: 1,
    dashboardId: `dashboard-${projectId}`.slice(0, 64),
    name: content.name,
    deviceScope: content.deviceScope,
    dateRange: content.dateRange,
    widgets: cloneWidgets(content.widgets),
  };
}
