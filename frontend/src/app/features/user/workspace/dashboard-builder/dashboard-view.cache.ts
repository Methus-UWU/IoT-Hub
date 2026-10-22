import { Service } from '@angular/core';

import type { DashboardView } from './dashboard-api.client';

/**
 * The last dashboard view the server returned, per project, for this browser session.
 *
 * The builder page is destroyed when the user switches to the IDE or the canvas, and a
 * fresh page used to show a skeleton until the dashboard came back. With this, a return
 * visit draws the last known dashboard at once and checks the server behind it. Memory
 * only; the server stays the source of truth, and its version decides what is current.
 */
@Service()
export class DashboardViewCache {
  private readonly views = new Map<string, DashboardView>();
  private readonly componentLists = new Map<string, { id: string; label: string }[]>();

  view(projectId: string): DashboardView | undefined {
    return this.views.get(projectId);
  }

  setView(projectId: string, view: DashboardView): void {
    this.views.set(projectId, view);
  }

  components(projectId: string): { id: string; label: string }[] | undefined {
    return this.componentLists.get(projectId);
  }

  setComponents(projectId: string, components: { id: string; label: string }[]): void {
    this.componentLists.set(projectId, components);
  }

  /** Something else changed the dashboard, such as an applied assistant plan. */
  forget(projectId: string): void {
    this.views.delete(projectId);
    this.componentLists.delete(projectId);
  }

  /** Another account signs in next. */
  clear(): void {
    this.views.clear();
    this.componentLists.clear();
  }
}
