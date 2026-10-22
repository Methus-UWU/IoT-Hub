import { Component, effect, inject, input, output, signal } from '@angular/core';

import {
  DashboardApiClient,
  DashboardTemplateSummary,
  DashboardView,
} from './dashboard-api.client';
import { DashboardIcon } from './dashboard-icon';
import { apiErrorMessage } from '../../../../core/models/api-error';

export interface TemplateApplied {
  view: DashboardView;
  warnings: string[];
}

/**
 * Dashboard templates for the open project: save this dashboard as one, apply one,
 * duplicate, share with the workspace, publish a new version, or delete.
 *
 * Every rule — who may edit, which bindings a project can honour — is the server's;
 * this panel only words its answers. Destructive steps ask once, inline, instead of a
 * browser dialog.
 */
@Component({
  selector: 'app-dashboard-templates',
  imports: [DashboardIcon],
  template: `
    <header class="templates-head">
      <div>
        <h2>Dashboard templates</h2>
        <p>Build a dashboard once, reuse it on every board.</p>
      </div>
      <button
        type="button"
        class="icon-button"
        aria-label="Close templates"
        (click)="closed.emit()"
      >
        <app-dashboard-icon name="close" />
      </button>
    </header>

    <form class="template-save" (submit)="saveAsTemplate($event)">
      <h3>Save this dashboard as a template</h3>
      <label>
        <span>Name</span>
        <input name="name" required maxlength="80" placeholder="Smart Home Monitor" />
      </label>
      <label>
        <span>Description</span>
        <input name="description" maxlength="500" placeholder="What the template shows" />
      </label>
      <label class="check">
        <input type="checkbox" name="shared" />
        <span>Share with everyone in this workspace</span>
      </label>
      <button type="submit" class="primary" [disabled]="busy() || !hasWidgets()">
        Save as template
      </button>
      @if (!hasWidgets()) {
        <small>Add widgets first. An empty dashboard is not a template.</small>
      }
    </form>

    <section class="template-list" aria-label="Templates" [attr.aria-busy]="loading()">
      <h3>Templates</h3>
      @if (loading()) {
        @for (row of [1, 2, 3]; track row) {
          <div class="template-skeleton" aria-hidden="true"><span></span><span></span></div>
        }
      } @else if (templates().length === 0) {
        <p class="empty">No templates yet.</p>
      } @else {
        <ul>
          @for (template of templates(); track template.id) {
            <li>
              <div class="template-meta">
                <strong>{{ template.name }}</strong>
                <small>
                  {{ template.boardId }} · v{{ template.latestVersion }} ·
                  {{ template.visibility === 'workspace' ? 'Shared' : 'Private' }}
                </small>
                @if (template.description) {
                  <p>{{ template.description }}</p>
                }
              </div>
              <div class="template-actions">
                @if (confirming() === 'apply:' + template.id) {
                  <button
                    type="button"
                    class="primary"
                    [disabled]="busy()"
                    (click)="apply(template)"
                  >
                    Replace dashboard
                  </button>
                  <button type="button" (click)="confirming.set(null)">Cancel</button>
                } @else if (confirming() === 'delete:' + template.id) {
                  <button
                    type="button"
                    class="danger"
                    [disabled]="busy()"
                    (click)="remove(template)"
                  >
                    Delete template
                  </button>
                  <button type="button" (click)="confirming.set(null)">Cancel</button>
                } @else {
                  <button
                    type="button"
                    class="primary"
                    [disabled]="busy()"
                    (click)="requestApply(template)"
                  >
                    Use
                  </button>
                  <button type="button" [disabled]="busy()" (click)="duplicate(template)">
                    Duplicate
                  </button>
                  <button type="button" [disabled]="busy()" (click)="toggleSharing(template)">
                    {{ template.visibility === 'workspace' ? 'Make private' : 'Share' }}
                  </button>
                  <button
                    type="button"
                    [disabled]="busy() || !hasWidgets()"
                    (click)="publishVersion(template)"
                  >
                    New version from this dashboard
                  </button>
                  <button
                    type="button"
                    class="danger-text"
                    [disabled]="busy()"
                    (click)="confirming.set('delete:' + template.id)"
                  >
                    Delete
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styleUrl: './dashboard-templates.css',
})
export class DashboardTemplates {
  private readonly api = inject(DashboardApiClient);

  readonly projectId = input.required<string>();
  readonly open = input(false);
  readonly hasWidgets = input(false);
  /** The dashboard version a template apply replaces. */
  readonly dashboardVersion = input(0);
  /** Whether applying replaces widgets the user would lose. */
  readonly replacesWidgets = input(false);

  readonly applied = output<TemplateApplied>();
  readonly message = output<{ text: string; kind: 'success' | 'warning' }>();
  readonly closed = output<void>();

  protected readonly templates = signal<DashboardTemplateSummary[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly confirming = signal<string | null>(null);

  private readonly loadOnOpen = effect(() => {
    if (this.open()) void this.refresh();
  });

  protected async saveAsTemplate(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return;
    await this.run(async () => {
      await this.api.createTemplate(this.projectId(), {
        name,
        description: String(data.get('description') ?? '').trim(),
        visibility: data.get('shared') ? 'workspace' : 'private',
      });
      form.reset();
      this.message.emit({ text: `Template "${name}" saved`, kind: 'success' });
      await this.refresh();
    });
  }

  protected requestApply(template: DashboardTemplateSummary): void {
    if (this.replacesWidgets()) {
      this.confirming.set('apply:' + template.id);
      return;
    }
    void this.apply(template);
  }

  protected async apply(template: DashboardTemplateSummary): Promise<void> {
    await this.run(async () => {
      const result = await this.api.applyTemplate(
        this.projectId(),
        template.id,
        this.dashboardVersion(),
      );
      this.applied.emit({ view: result.dashboard, warnings: result.warnings });
      this.closed.emit();
    });
  }

  protected async duplicate(template: DashboardTemplateSummary): Promise<void> {
    await this.run(async () => {
      await this.api.duplicateTemplate(template.id);
      this.message.emit({ text: 'Template duplicated as a private copy', kind: 'success' });
      await this.refresh();
    });
  }

  protected async toggleSharing(template: DashboardTemplateSummary): Promise<void> {
    await this.run(async () => {
      await this.api.updateTemplate(template.id, {
        visibility: template.visibility === 'workspace' ? 'private' : 'workspace',
      });
      await this.refresh();
    });
  }

  protected async publishVersion(template: DashboardTemplateSummary): Promise<void> {
    await this.run(async () => {
      const updated = await this.api.addTemplateVersion(template.id, this.projectId());
      this.message.emit({
        text: `"${updated.name}" is now version ${updated.latestVersion}`,
        kind: 'success',
      });
      await this.refresh();
    });
  }

  protected async remove(template: DashboardTemplateSummary): Promise<void> {
    await this.run(async () => {
      await this.api.deleteTemplate(template.id);
      this.message.emit({ text: 'Template deleted', kind: 'success' });
      await this.refresh();
    });
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.templates.set(await this.api.listTemplates());
    } catch {
      this.message.emit({ text: 'Templates could not be loaded.', kind: 'warning' });
    } finally {
      this.loading.set(false);
    }
  }

  /** One action at a time; the server's own message is shown when it refuses. */
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.confirming.set(null);
    try {
      await action();
    } catch (error: unknown) {
      this.message.emit({
        text: apiErrorMessage(error) ?? 'The template action failed. Try again.',
        kind: 'warning',
      });
    } finally {
      this.busy.set(false);
    }
  }
}
