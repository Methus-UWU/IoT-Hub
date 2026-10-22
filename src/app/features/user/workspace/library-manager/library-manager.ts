import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';

import { apiErrorMessage } from '../../../../core/models/api-error';
import { boardFamily } from '../firmware/web-serial';
import {
  InstallOutcome,
  InstalledLibrary,
  LibraryApiClient,
  LibraryDetails,
  LibraryPlatform,
  LibrarySort,
  LibrarySummary,
} from './library-api.client';

type ManagerTab = 'browse' | 'installed';

interface Status {
  text: string;
  kind: 'success' | 'warning';
}

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: 'popularity', label: 'Most popular' },
  { value: 'trending', label: 'Trending' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'relevance', label: 'Best match' },
];

/**
 * Library Manager, like Arduino IDE's and PlatformIO's: search the PlatformIO registry,
 * install a library (and what it depends on) into the project's `lib/`, change its
 * version, or remove it. The server does the downloading and checking; this dialog
 * only asks and reports.
 */
@Component({
  selector: 'app-library-manager',
  imports: [DatePipe],
  templateUrl: './library-manager.html',
  styleUrl: './library-manager.css',
  // Modal: Escape closes it wherever focus is, even after the focused button went away.
  host: { '(document:keydown.escape)': 'closed.emit()' },
})
export class LibraryManager {
  private readonly api = inject(LibraryApiClient);

  readonly projectId = input.required<string>();
  readonly board = input('');
  /** Files under `lib/` changed: the editor reloads the project's file list. */
  readonly changed = output<void>();
  readonly closed = output<void>();

  protected readonly sorts = SORTS;
  protected readonly tab = signal<ManagerTab>('browse');
  protected readonly query = signal('');
  protected readonly sort = signal<LibrarySort>('popularity');
  protected readonly results = signal<LibrarySummary[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly searching = signal(false);
  protected readonly searchFailed = signal(false);
  protected readonly installed = signal<InstalledLibrary[]>([]);
  protected readonly loadingInstalled = signal(true);
  /** `owner/name` or folder of the library an action is running on. */
  protected readonly busy = signal<string | null>(null);
  protected readonly confirmingRemove = signal<string | null>(null);
  protected readonly versionsFor = signal<LibraryDetails | null>(null);
  protected readonly status = signal<Status | null>(null);

  protected readonly platform = computed((): LibraryPlatform | undefined => {
    const family = boardFamily(this.board());
    if (family === 'esp32') return 'espressif32';
    if (family === 'avr') return 'atmelavr';
    return undefined;
  });
  protected readonly hasMore = computed(() => this.results().length < this.total());

  private readonly loadForProject = effect(() => {
    const projectId = this.projectId();
    void this.refreshInstalled(projectId);
    void this.search(1);
  });

  protected installedVersion(library: { owner: string; name: string }): string | null {
    const match = this.installed().find(
      (entry) =>
        entry.owner.toLowerCase() === library.owner.toLowerCase() &&
        entry.name.toLowerCase() === library.name.toLowerCase(),
    );
    return match?.version ?? null;
  }

  protected key(library: { owner: string; name: string }): string {
    return `${library.owner}/${library.name}`;
  }

  protected submitSearch(event: Event): void {
    event.preventDefault();
    void this.search(1);
  }

  protected changeSort(value: string): void {
    this.sort.set(value as LibrarySort);
    void this.search(1);
  }

  protected async search(page: number): Promise<void> {
    this.searching.set(true);
    this.searchFailed.set(false);
    try {
      const result = await this.api.search(this.query().trim(), {
        page,
        sort: this.sort(),
        platform: this.platform(),
      });
      this.results.update((current) => (page === 1 ? result.items : [...current, ...result.items]));
      this.total.set(result.total);
      this.page.set(page);
    } catch {
      this.searchFailed.set(true);
      if (page === 1) this.results.set([]);
    } finally {
      this.searching.set(false);
    }
  }

  protected async install(
    library: { owner: string; name: string },
    version?: string,
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(this.key(library));
    this.status.set(null);
    try {
      const outcome = await this.api.install(this.projectId(), {
        owner: library.owner,
        name: library.name,
        ...(version ? { version } : {}),
      });
      this.status.set(this.describeInstall(outcome));
      this.versionsFor.set(null);
      this.changed.emit();
      await this.refreshInstalled(this.projectId());
    } catch (error: unknown) {
      this.status.set({
        text: this.errorText(error, 'ติดตั้ง library ไม่สำเร็จ'),
        kind: 'warning',
      });
    } finally {
      this.busy.set(null);
    }
  }

  protected async showVersions(library: { owner: string; name: string }): Promise<void> {
    if (this.versionsFor() && this.key(this.versionsFor()!) === this.key(library)) {
      this.versionsFor.set(null);
      return;
    }
    this.busy.set(this.key(library));
    try {
      this.versionsFor.set(await this.api.details(library.owner, library.name));
    } catch (error: unknown) {
      this.status.set({
        text: this.errorText(error, 'โหลดรายการเวอร์ชันไม่สำเร็จ'),
        kind: 'warning',
      });
    } finally {
      this.busy.set(null);
    }
  }

  protected async remove(library: InstalledLibrary): Promise<void> {
    if (this.busy()) return;
    this.busy.set(library.folder);
    this.confirmingRemove.set(null);
    try {
      await this.api.remove(this.projectId(), library.folder);
      this.status.set({ text: `ลบ ${library.name} ออกจากโปรเจกต์แล้ว`, kind: 'success' });
      this.changed.emit();
      await this.refreshInstalled(this.projectId());
    } catch (error: unknown) {
      this.status.set({ text: this.errorText(error, 'ลบ library ไม่สำเร็จ'), kind: 'warning' });
    } finally {
      this.busy.set(null);
    }
  }

  protected formatSize(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  }

  private async refreshInstalled(projectId: string): Promise<void> {
    this.loadingInstalled.set(true);
    try {
      const libraries = await this.api.installed(projectId);
      if (projectId === this.projectId()) this.installed.set(libraries);
    } catch {
      this.status.set({ text: 'โหลดรายการ library ที่ติดตั้งไม่สำเร็จ', kind: 'warning' });
    } finally {
      this.loadingInstalled.set(false);
    }
  }

  private describeInstall(outcome: InstallOutcome): Status {
    const [main, ...dependencies] = outcome.installed;
    let text = main ? `ติดตั้ง ${main.name} ${main.version} แล้ว` : 'ติดตั้งแล้ว';
    if (dependencies.length) {
      text += ` พร้อม ${dependencies.map((entry) => entry.name).join(', ')}`;
    }
    if (outcome.skipped.length) {
      text += ` · ข้าม: ${outcome.skipped.map((entry) => `${entry.name} (${entry.reason})`).join('; ')}`;
    }
    return { text, kind: outcome.skipped.length ? 'warning' : 'success' };
  }

  private errorText(error: unknown, fallback: string): string {
    const message = apiErrorMessage(error);
    if (message) return message;
    if (error instanceof HttpErrorResponse && error.status === 0) {
      return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
    }
    return fallback;
  }
}
