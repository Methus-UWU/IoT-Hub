import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import {
  CustomSelect,
  CustomSelectOption,
} from '../../../shared/components/custom-select/custom-select';
import { CreateProjectDialog } from './create-project-dialog';
import { PlanUsageCard, UsageMetric } from './plan-usage-card';
import { UsageApiService } from '../../../core/services/usage-api.service';
import {
  NewProjectValue,
  ProjectStatus,
  ProjectStore,
  isPlanLimitError,
} from './project.store';

type StatusFilter = 'all' | ProjectStatus;
type SortOption = 'name' | 'recent';
type ViewMode = 'grid' | 'list';

const STATUS_FILTER_OPTIONS: readonly CustomSelectOption[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'online', label: 'Deployed' },
  { value: 'draft', label: 'Draft' },
  { value: 'building', label: 'Building' },
];

const SORT_OPTIONS: readonly CustomSelectOption[] = [
  { value: 'name', label: 'Sorted by name' },
  { value: 'recent', label: 'Recently created' },
];

@Component({
  selector: 'app-projects-page',
  imports: [CustomSelect, CreateProjectDialog, PlanUsageCard],
  templateUrl: './projects.page.html',
  styleUrl: './projects.page.css',
})
export class ProjectsPage {
  private readonly projectStore = inject(ProjectStore);
  private readonly router = inject(Router);
  private readonly usageApi = inject(UsageApiService);

  protected readonly projects = this.projectStore.projects;
  protected readonly usageMetrics = signal<readonly UsageMetric[]>([]);
  protected readonly usageLoading = signal(true);
  protected readonly createError = signal<string | null>(null);
  protected readonly loadingProjects = this.projectStore.loading;
  protected readonly hasLoaded = this.projectStore.hasLoaded;
  protected readonly loadError = this.projectStore.error;
  protected readonly statusFilterOptions = STATUS_FILTER_OPTIONS;
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly searchQuery = signal('');
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly sortOption = signal<SortOption>('name');
  protected readonly viewMode = signal<ViewMode>('grid');
  protected readonly createDialogOpen = signal(false);

  constructor() {
    void this.projectStore.load();
    void this.loadUsage();
  }

  /** Usage comes from the API; nothing on this page is a sample number. */
  private async loadUsage(): Promise<void> {
    this.usageLoading.set(true);
    try {
      this.usageMetrics.set(await this.usageApi.load());
    } catch {
      this.usageMetrics.set([]);
    } finally {
      this.usageLoading.set(false);
    }
  }

  protected readonly filteredProjects = computed(() => {
    const query = this.searchQuery().trim().toLocaleLowerCase();
    const status = this.statusFilter();
    const sort = this.sortOption();

    return this.projects()
      .filter((project) => status === 'all' || project.status === status)
      .filter(
        (project) =>
          !query ||
          project.name.toLocaleLowerCase().includes(query) ||
          project.board.toLocaleLowerCase().includes(query) ||
          project.framework.toLocaleLowerCase().includes(query),
      )
      .sort((first, second) =>
        sort === 'name'
          ? first.name.localeCompare(second.name)
          : second.updatedAt - first.updatedAt,
      );
  });

  protected updateSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected updateStatus(value: string): void {
    this.statusFilter.set(value as StatusFilter);
  }

  protected updateSort(value: string): void {
    this.sortOption.set(value as SortOption);
  }

  protected setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
  }

  protected openCreateDialog(): void {
    this.createDialogOpen.set(true);
  }

  protected closeCreateDialog(): void {
    this.createDialogOpen.set(false);
  }

  protected async addProject(value: NewProjectValue): Promise<void> {
    this.createError.set(null);

    try {
      const project = await this.projectStore.create(value);
      this.createDialogOpen.set(false);
      void this.loadUsage();
      void this.router.navigate([
        '/user/projects',
        project.id,
        'virtual-device',
      ]);
    } catch (error) {
      // The backend owns plan limits, so a refusal arrives here rather than
      // being predicted locally. Surfacing it beats failing silently.
      const limit = isPlanLimitError(error);
      this.createError.set(
        limit
          ? limit.message
          : 'ไม่สามารถสร้างโปรเจกต์ได้ กรุณาลองใหม่อีกครั้ง',
      );
    }
  }

  protected openProject(projectId: string): void {
    void this.router.navigate(['/user/projects', projectId, 'ide']);
  }
}
