import { Service, signal } from '@angular/core';

export interface WorkspaceFileState {
  content: string;
  savedContent: string;
}

type ProjectBuffers = Readonly<Record<string, WorkspaceFileState>>;

const EMPTY: ProjectBuffers = {};

/**
 * The editor's open text, held outside the IDE page.
 *
 * Every project tab (dashboard, canvas, IDE) is its own route, so leaving the IDE destroys
 * the page. While the buffers lived in the page, returning meant an empty editor until the
 * file list and every file were fetched again, and an edit typed in the second before
 * leaving was dropped with its pending autosave. Holding the buffers here keeps the text,
 * the unsaved state, and the "already read from the server" markers across navigation, so
 * the editor paints the moment it is created and nothing is fetched twice.
 *
 * Buffers are keyed by project, and switching project drops the previous project's clean
 * buffers, so text never crosses projects. Signing out clears everything.
 */
@Service()
export class WorkspaceFileBuffers {
  private readonly buffers = signal<Readonly<Record<string, ProjectBuffers>>>({});
  /** Projects whose file list was fetched (or failed to) in this session. */
  private readonly listedProjects = new Set<string>();
  /** `projectId:path` read from the server since it was last marked stale. */
  readonly hydrated = new Set<string>();
  /** The server read in flight, or settled, per `projectId:path`. */
  readonly hydrations = new Map<string, Promise<void>>();

  filesOf(projectId: string | null): ProjectBuffers {
    return (projectId && this.buffers()[projectId]) || EMPTY;
  }

  set(projectId: string, path: string, state: WorkspaceFileState): void {
    this.buffers.update((all) => ({
      ...all,
      [projectId]: { ...(all[projectId] ?? EMPTY), [path]: state },
    }));
  }

  /** Applies `change` to an existing buffer; a missing buffer stays missing. */
  patch(
    projectId: string,
    path: string,
    change: (state: WorkspaceFileState) => WorkspaceFileState,
  ): void {
    const current = this.filesOf(projectId)[path];
    if (!current) return;
    const next = change(current);
    if (next !== current) this.set(projectId, path, next);
  }

  remove(projectId: string, path: string): void {
    this.forgetHydration(projectId, path);
    const project = this.buffers()[projectId];
    if (!project?.[path]) return;
    const { [path]: _removed, ...rest } = project;
    this.buffers.update((all) => ({ ...all, [projectId]: rest }));
  }

  isListed(projectId: string): boolean {
    return this.listedProjects.has(projectId);
  }

  markListed(projectId: string): void {
    this.listedProjects.add(projectId);
  }

  /**
   * Someone else wrote these files — the assistant applying a plan, usually.
   *
   * The buffers stay, so the editor keeps showing text instead of going blank, but the
   * next read goes back to the server. That read replaces a clean buffer and leaves one
   * with unsaved edits alone.
   */
  markStale(projectId: string, paths: readonly string[]): void {
    for (const path of paths) this.forgetHydration(projectId, path);
  }

  /**
   * Keeps one project's buffers and drops every other project's clean ones.
   *
   * A buffer with unsaved text is kept: its save is still in flight or failed, and
   * dropping it would lose the edit.
   */
  retainProject(projectId: string): void {
    const all = this.buffers();
    const next: Record<string, ProjectBuffers> = {};
    for (const [id, files] of Object.entries(all)) {
      if (id === projectId) {
        next[id] = files;
        continue;
      }
      const dirty = Object.entries(files).filter(
        ([, state]) => state.content !== state.savedContent,
      );
      for (const path of Object.keys(files)) this.forgetHydration(id, path);
      if (dirty.length) next[id] = Object.fromEntries(dirty);
      else this.listedProjects.delete(id);
    }
    this.buffers.set(next);
  }

  /** Clears user-scoped text before another account can enter the application. */
  reset(): void {
    this.buffers.set({});
    this.listedProjects.clear();
    this.hydrated.clear();
    this.hydrations.clear();
  }

  private forgetHydration(projectId: string, path: string): void {
    const key = `${projectId}:${path}`;
    this.hydrated.delete(key);
    this.hydrations.delete(key);
  }
}
