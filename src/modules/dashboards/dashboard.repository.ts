/**
 * Persistence contracts for dashboards, datastreams, and templates.
 *
 * Documents cross this boundary as `unknown`: the repository stores and returns JSON,
 * and only `parseDashboardDocument` decides what a valid document is.
 */

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

/** A datastream as a template carries it: no component, which belongs to one project. */
export type DatastreamTemplate = Omit<Datastream, 'id' | 'componentId'>;

export interface StoredDashboard {
  id: string;
  name: string;
  document: unknown;
  version: number;
  templateId: string | null;
  templateVersion: number | null;
  updatedAt: Date;
}

export interface DashboardWrite {
  name: string;
  document: unknown;
  templateId?: string | null;
  templateVersion?: number | null;
}

export abstract class DashboardRepository {
  abstract find(projectId: string): Promise<StoredDashboard | null>;

  /** Null when the project already has a dashboard. */
  abstract create(
    projectId: string,
    input: DashboardWrite,
  ): Promise<StoredDashboard | null>;

  /** Null when the stored version is no longer `expectedVersion`. */
  abstract updateIfVersionMatches(
    projectId: string,
    expectedVersion: number,
    input: DashboardWrite,
  ): Promise<StoredDashboard | null>;

  /**
   * Writes the dashboard and adds the datastreams whose keys the project lacks, in one
   * transaction, so a template is never half applied. `expectedVersion` null means the
   * project must not have a dashboard yet. Null when that expectation failed.
   */
  abstract writeWithDatastreams(
    projectId: string,
    expectedVersion: number | null,
    input: DashboardWrite,
    datastreams: readonly DatastreamInput[],
  ): Promise<StoredDashboard | null>;

  abstract listDatastreams(projectId: string): Promise<Datastream[]>;

  /** Null when the key is taken in this project. */
  abstract createDatastream(
    projectId: string,
    input: DatastreamInput,
  ): Promise<Datastream | null>;

  /** Null when the datastream is not in this project; 'taken' when the new key is. */
  abstract updateDatastream(
    projectId: string,
    datastreamId: string,
    input: DatastreamInput,
  ): Promise<Datastream | null | 'taken'>;

  abstract deleteDatastream(
    projectId: string,
    datastreamId: string,
  ): Promise<boolean>;
}

export type TemplateVisibility = 'private' | 'workspace';

export interface DashboardTemplate {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  boardId: string;
  visibility: TemplateVisibility;
  latestVersion: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardTemplateVersion {
  templateId: string;
  version: number;
  document: unknown;
  datastreams: unknown;
  createdAt: Date;
}

export interface TemplateMetadata {
  name: string;
  description: string;
  boardId: string;
  visibility: TemplateVisibility;
}

export interface TemplateContent {
  document: unknown;
  datastreams: readonly DatastreamTemplate[];
}

export abstract class DashboardTemplateRepository {
  /** Templates this user may see: the workspace's shared ones and their own. */
  abstract listVisible(
    workspaceId: string,
    userId: string,
  ): Promise<DashboardTemplate[]>;

  abstract find(
    workspaceId: string,
    templateId: string,
  ): Promise<DashboardTemplate | null>;

  abstract findVersion(
    templateId: string,
    version: number,
  ): Promise<DashboardTemplateVersion | null>;

  /** Creates the template with version 1. */
  abstract create(
    workspaceId: string,
    createdBy: string,
    metadata: TemplateMetadata,
    content: TemplateContent,
  ): Promise<DashboardTemplate>;

  /** Adds the next version and moves `latestVersion` to it, atomically. */
  abstract addVersion(
    templateId: string,
    createdBy: string,
    content: TemplateContent,
  ): Promise<DashboardTemplate>;

  abstract updateMetadata(
    templateId: string,
    metadata: Partial<TemplateMetadata>,
  ): Promise<DashboardTemplate>;

  abstract delete(templateId: string): Promise<void>;
}
