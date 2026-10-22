export type TelemetryValue = number | boolean | string;

export interface DeviceRecord {
  id: string;
  projectId: string;
  name: string;
  tokenHint: string;
  lastSeenAt: Date | null;
  createdAt: Date;
}

export interface DeviceValueRecord {
  key: string;
  value: TelemetryValue;
  source: 'device' | 'app';
  updatedAt: Date;
}

export interface TelemetryPointRecord {
  value: number | null;
  text: string | null;
  recordedAt: Date;
}

export interface NewTelemetryPoint {
  key: string;
  value: number | null;
  text: string | null;
}

export abstract class DeviceRepository {
  abstract list(projectId: string): Promise<DeviceRecord[]>;

  abstract find(id: string): Promise<DeviceRecord | null>;

  abstract findByTokenHash(tokenHash: string): Promise<DeviceRecord | null>;

  abstract count(projectId: string): Promise<number>;

  abstract create(input: {
    projectId: string;
    name: string;
    tokenHash: string;
    tokenHint: string;
    createdBy: string;
  }): Promise<DeviceRecord>;

  abstract rename(id: string, name: string): Promise<DeviceRecord>;

  abstract replaceToken(
    id: string,
    tokenHash: string,
    tokenHint: string,
  ): Promise<DeviceRecord>;

  abstract delete(id: string): Promise<void>;

  /** Records that the device was heard from. */
  abstract touch(id: string, at: Date): Promise<void>;

  abstract latestValues(deviceId: string): Promise<DeviceValueRecord[]>;

  /**
   * Upserts the latest values and appends history points, in one transaction.
   * `points` may be empty: a value set by a dashboard control is not history.
   */
  abstract writeValues(
    deviceId: string,
    values: { key: string; value: TelemetryValue; source: 'device' | 'app' }[],
    points: NewTelemetryPoint[],
  ): Promise<void>;

  /** The newest `limit` points since `since`, oldest first. */
  abstract series(
    deviceId: string,
    key: string,
    since: Date,
    limit: number,
  ): Promise<TelemetryPointRecord[]>;

  /** Deletes history older than `before`; returns how many points went. */
  abstract prune(before: Date): Promise<number>;
}
