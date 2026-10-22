import { Service, computed, inject, signal } from '@angular/core';
import { Observable, map, of, shareReplay, tap } from 'rxjs';

import {
  ProjectsApiService,
  WorkspaceSummary,
} from './projects-api.service';

/**
 * Resolves which workspace the signed-in user is working in.
 *
 * Every account gets a personal workspace when it is created, so the first
 * membership is a safe default until the UI offers a workspace switcher. The
 * request is shared rather than repeated: several features ask for this during the
 * same navigation, and they should not each trigger a round trip.
 */
@Service()
export class WorkspaceContextService {
  private readonly api = inject(ProjectsApiService);

  private readonly workspacesState = signal<readonly WorkspaceSummary[]>([]);
  private readonly activeIdState = signal<string | null>(null);
  private inFlight: Observable<WorkspaceSummary | null> | null = null;

  readonly workspaces = this.workspacesState.asReadonly();
  readonly activeWorkspace = computed(
    () =>
      this.workspacesState().find(
        (workspace) => workspace.id === this.activeIdState(),
      ) ?? null,
  );
  readonly activeWorkspaceId = computed(() => this.activeIdState());

  /** Loads the user's workspaces once and selects the first as active. */
  ensureLoaded(): Observable<WorkspaceSummary | null> {
    const active = this.activeWorkspace();
    if (active) return of(active);

    this.inFlight ??= this.api.listWorkspaces().pipe(
      tap((workspaces) => {
        this.workspacesState.set(workspaces);
        this.activeIdState.set(workspaces[0]?.id ?? null);
      }),
      map((workspaces) => workspaces[0] ?? null),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    return this.inFlight;
  }

  setActive(workspaceId: string): void {
    if (this.workspacesState().some((workspace) => workspace.id === workspaceId)) {
      this.activeIdState.set(workspaceId);
    }
  }

  /** Discards cached workspaces, e.g. after sign-out. */
  reset(): void {
    this.workspacesState.set([]);
    this.activeIdState.set(null);
    this.inFlight = null;
  }
}
