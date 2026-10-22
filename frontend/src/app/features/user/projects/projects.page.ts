import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';

import {
  CustomSelect,
  CustomSelectOption,
} from '../../../shared/components/custom-select/custom-select';
import { CreateProjectDialog } from './create-project-dialog';
import { ProjectActionsMenu } from './project-actions-menu';
import { NewProjectValue, ProjectStatus, ProjectStore, isPlanLimitError } from './project.store';

type StatusFilter = 'all' | ProjectStatus;
type SortOption = 'name' | 'recent';
type ViewMode = 'grid' | 'list';

const STATUS_FILTER_OPTIONS: readonly CustomSelectOption[] = [
  { value: 'all', label: 'ทุกสถานะ' },
  { value: 'online', label: 'นำขึ้นใช้งานแล้ว' },
  { value: 'draft', label: 'ฉบับร่าง' },
  { value: 'building', label: 'กำลังบิลด์' },
];

const SORT_OPTIONS: readonly CustomSelectOption[] = [
  { value: 'name', label: 'เรียงตามชื่อ' },
  { value: 'recent', label: 'สร้างล่าสุด' },
];

@Component({
  selector: 'app-projects-page',
  imports: [DatePipe, CustomSelect, CreateProjectDialog, ProjectActionsMenu],
  templateUrl: './projects.page.html',
  styleUrl: './projects.page.css',
})
export class ProjectsPage {
  private readonly projectStore = inject(ProjectStore);
  private readonly router = inject(Router);

  protected readonly projects = this.projectStore.projects;
  protected readonly createError = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly loadingProjects = this.projectStore.loading;
  protected readonly hasLoaded = this.projectStore.hasLoaded;
  protected readonly loadError = this.projectStore.error;
  protected readonly statusFilterOptions = STATUS_FILTER_OPTIONS;
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly statusLabels: Record<ProjectStatus, string> = {
    draft: 'พร้อมบิลด์',
    building: 'กำลังบิลด์…',
    online: 'เว็บเซิร์ฟเวอร์ออนไลน์',
  };
  protected readonly searchQuery = signal('');
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly sortOption = signal<SortOption>('name');
  protected readonly viewMode = signal<ViewMode>('grid');
  /** How many placeholder cards stand in for the list while it loads. */
  /**
   * One row of placeholder cards at desktop width.
   *
   * The count is a guess at something unknowable, so it errs low: a second row that
   * disappears when two projects arrive moves the whole page, while one row that grows is
   * the same motion the user gets from any list.
   */
  protected readonly skeletonCards = [0, 1, 2, 3] as const;
  protected readonly createDialogOpen = signal(false);
  protected readonly actionNotice = signal('');
  private readonly newProjectButton = viewChild<ElementRef<HTMLButtonElement>>('newProjectButton');

  protected projectDeleted(): void {
    this.actionNotice.set('ลบโปรเจกต์แล้ว');
    this.newProjectButton()?.nativeElement.focus();
  }

  constructor() {
    // Re-entering this page must fetch the persisted activity timestamp. Circuit
    // and source edits happen on child resources while this store stays alive.
    void this.projectStore.load(true);
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

  protected clearFilters(): void {
    this.searchQuery.set('');
    this.statusFilter.set('all');
  }

  protected retryLoad(): void {
    void this.projectStore.load(true);
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
    this.createError.set(null);
    this.createDialogOpen.set(true);
  }

  protected closeCreateDialog(): void {
    if (this.creating()) return;
    this.createDialogOpen.set(false);
  }

  protected async addProject(value: NewProjectValue): Promise<void> {
    if (this.creating()) return;
    this.creating.set(true);
    this.createError.set(null);

    try {
      const project = await this.projectStore.create(value);
      this.createDialogOpen.set(false);
      // A description is built straight away on the setup page; an AI project
      // without one has nothing to build and opens in the IDE.
      const aiBuild = value.setupMode === 'ai' && value.description.trim().length > 0;
      void this.router.navigate([
        '/user/projects',
        project.id,
        aiBuild ? 'setup' : value.setupMode === 'ai' ? 'ide' : 'virtual-device',
      ]);
    } catch (error) {
      // The backend owns plan limits, so a refusal arrives here rather than
      // being predicted locally. Surfacing it beats failing silently.
      const limit = isPlanLimitError(error);
      this.createError.set(
        limit
          ? limit.message || 'จำนวนโปรเจกต์หรืออุปกรณ์เกินโควตาของแผนปัจจุบัน'
          : 'ไม่สามารถสร้างโปรเจกต์ได้ กรุณาลองใหม่อีกครั้ง',
      );
    } finally {
      this.creating.set(false);
    }
  }

  protected openProject(projectId: string): void {
    void this.router.navigate(['/user/projects', projectId, 'ide']);
  }
}
