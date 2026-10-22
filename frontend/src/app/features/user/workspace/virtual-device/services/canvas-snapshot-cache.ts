import { Service } from '@angular/core';

import type {
  DeviceInstance,
  DevicePlacement,
  DeviceState,
  Point,
  WireConnection,
  WireJunction,
} from '../models/virtual-device.model';

/** Everything the canvas needs to draw a project without asking the server. */
export interface CanvasSnapshot {
  readonly instances: readonly DeviceInstance[];
  readonly placements: Readonly<Record<string, DevicePlacement>>;
  readonly deviceStates: Readonly<Record<string, DeviceState>>;
  readonly connections: readonly WireConnection[];
  readonly junctions: Readonly<Record<string, WireJunction>>;
  /** The view the user left, so returning does not re-centre the canvas. */
  readonly zoom: number;
  readonly pan: Point;
}

/**
 * The canvas as the user last left it, per project, for this browser session.
 *
 * Switching from the canvas to the IDE and back destroys the page, and a fresh
 * page used to show a loading state until two requests came back. With this the
 * page draws the remembered circuit at once and refreshes from the server behind
 * it. Memory only: the server stays the source of truth, and anything that
 * changes the circuit elsewhere — an applied assistant plan — forgets the entry.
 */
@Service()
export class CanvasSnapshotCache {
  private readonly snapshots = new Map<string, CanvasSnapshot>();

  get(projectId: string): CanvasSnapshot | undefined {
    return this.snapshots.get(projectId);
  }

  set(projectId: string, snapshot: CanvasSnapshot): void {
    this.snapshots.set(projectId, snapshot);
  }

  forget(projectId: string): void {
    this.snapshots.delete(projectId);
  }

  clear(): void {
    this.snapshots.clear();
  }
}
