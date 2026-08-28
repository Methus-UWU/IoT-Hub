import { Service, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  ProjectsApiService,
  RemoteComponent,
} from '../../../../../core/services/projects-api.service';
import { WorkspaceContextService } from '../../../../../core/services/workspace-context.service';

export interface CanvasComponent {
  /** Server id. Used directly as the canvas instance id so the two cannot drift. */
  id: string;
  definitionId: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  state: Record<string, unknown>;
}

/** Raised when the plan's per-project component ceiling refuses an add. */
export interface ComponentLimitRefusal {
  message: string;
  limit: number;
  used: number;
}

export function asComponentLimitRefusal(
  error: unknown,
): ComponentLimitRefusal | null {
  const body = (error as { error?: { error?: Record<string, unknown> } })?.error
    ?.error;
  if (!body || body['code'] !== 'COMPONENT_LIMIT_REACHED') return null;

  return {
    message: typeof body['message'] === 'string' ? body['message'] : '',
    limit: typeof body['limit'] === 'number' ? body['limit'] : 0,
    used: typeof body['used'] === 'number' ? body['used'] : 0,
  };
}

/** How long a drag must settle before the move is written. */
const SAVE_DEBOUNCE_MS = 400;

/**
 * Persistence for the device canvas.
 *
 * The canvas keeps its own reactive state; this service is only the bridge to the
 * API. Two decisions worth stating:
 *
 * 1. The server's component id is used directly as the canvas instance id. A
 *    separate local id would need a mapping table that can fall out of step, and
 *    every wire already references components by id.
 * 2. Moves are debounced per component. A drag emits a position on every pointer
 *    move; writing each one would be hundreds of requests for one gesture, and the
 *    intermediate positions are not worth storing.
 */
@Service()
export class ProjectCanvasService {
  private readonly api = inject(ProjectsApiService);
  private readonly workspaces = inject(WorkspaceContextService);

  private readonly pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingPatches = new Map<
    string,
    { x?: number; y?: number; rotation?: number }
  >();

  async load(projectId: string): Promise<CanvasComponent[]> {
    const workspaceId = await this.workspaceId();
    if (!workspaceId) return [];

    const remote = await firstValueFrom(
      this.api.listComponents(workspaceId, projectId),
    );
    return remote.map((component) => toCanvasComponent(component));
  }

  /**
   * Adds a component and returns it with the id the server assigned.
   *
   * Position is optional: omitting it lets the server pick a free cell rather
   * than stacking every new part at the same coordinates.
   */
  async add(
    projectId: string,
    definitionId: string,
    placement?: { x: number; y: number; label?: string },
  ): Promise<CanvasComponent | null> {
    const workspaceId = await this.workspaceId();
    if (!workspaceId) return null;

    const created = await firstValueFrom(
      this.api.addComponent(workspaceId, projectId, {
        definitionId,
        ...(placement
          ? { x: placement.x, y: placement.y, label: placement.label }
          : {}),
      }),
    );
    return toCanvasComponent(created);
  }

  /**
   * Queues a position or rotation change.
   *
   * Patches for the same component coalesce, so a drag that ends in one place
   * results in one write with the final position rather than one per frame.
   */
  queueTransform(
    projectId: string,
    componentId: string,
    patch: { x?: number; y?: number; rotation?: number },
  ): void {
    const merged = { ...this.pendingPatches.get(componentId), ...patch };
    this.pendingPatches.set(componentId, merged);

    const existing = this.pendingSaves.get(componentId);
    if (existing) clearTimeout(existing);

    this.pendingSaves.set(
      componentId,
      setTimeout(() => {
        void this.flush(projectId, componentId);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  /** Writes any queued change immediately, e.g. before leaving the page. */
  async flushAll(projectId: string): Promise<void> {
    const ids = [...this.pendingPatches.keys()];
    await Promise.all(ids.map((id) => this.flush(projectId, id)));
  }

  async remove(projectId: string, componentId: string): Promise<void> {
    // Drop any queued move first: writing a position for a component that is
    // about to be deleted would fail and log a spurious error.
    this.cancel(componentId);

    const workspaceId = await this.workspaceId();
    if (!workspaceId) return;

    await firstValueFrom(
      this.api.deleteComponent(workspaceId, projectId, componentId),
    );
  }

  private cancel(componentId: string): void {
    const timer = this.pendingSaves.get(componentId);
    if (timer) clearTimeout(timer);
    this.pendingSaves.delete(componentId);
    this.pendingPatches.delete(componentId);
  }

  private async flush(projectId: string, componentId: string): Promise<void> {
    const patch = this.pendingPatches.get(componentId);
    this.cancel(componentId);
    if (!patch) return;

    const workspaceId = await this.workspaceId();
    if (!workspaceId) return;

    await firstValueFrom(
      this.api.updateComponent(workspaceId, projectId, componentId, patch),
    );
  }

  private async workspaceId(): Promise<string | null> {
    const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
    return workspace?.id ?? null;
  }
}

function toCanvasComponent(remote: RemoteComponent): CanvasComponent {
  return {
    id: remote.id,
    definitionId: remote.definitionId,
    label: remote.label,
    x: remote.x,
    y: remote.y,
    rotation: remote.rotation,
    state: remote.state,
  };
}
