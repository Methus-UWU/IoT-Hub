import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

import { WorkspaceContextService } from '../../../core/services/workspace-context.service';
import { ProjectStore } from './project.store';

@Injectable()
export class ProjectActionsStore {
  private readonly projects = inject(ProjectStore);
  private readonly workspaces = inject(WorkspaceContextService);
  private readonly workspaceId = this.workspaces.activeWorkspaceId();
  private readonly pendingState = signal(false);
  private readonly errorState = signal<string | null>(null);

  readonly pending = this.pendingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly canDelete = computed(() => {
    const workspace = this.workspaces.activeWorkspace();
    return (
      workspace?.id === this.workspaceId &&
      (workspace?.role === 'owner' || workspace?.role === 'admin')
    );
  });

  async delete(projectId: string): Promise<boolean> {
    if (this.pending()) return false;
    this.errorState.set(null);
    if (!this.canDelete() || !this.workspaceId) {
      this.errorState.set('Only a workspace owner or admin can delete this project.');
      return false;
    }
    this.pendingState.set(true);
    try {
      await this.projects.delete(projectId, this.workspaceId);
      return true;
    } catch (error) {
      this.errorState.set(
        error instanceof HttpErrorResponse && error.status === 403
          ? 'Your permission to delete this project was refused. Contact the workspace owner.'
          : error instanceof HttpErrorResponse && error.status === 404
            ? 'This project or workspace is no longer available. Close this dialog and refresh the page.'
            : 'Could not delete the project. Check your connection and try again.',
      );
      return false;
    } finally {
      this.pendingState.set(false);
    }
  }
}
