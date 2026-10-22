import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import { WorkspaceContextService } from '../../../core/services/workspace-context.service';
import { FileIcon } from '../../../shared/components/file-icon/file-icon';
import { AccountAvatar } from '../../../shared/components/account-avatar/account-avatar';
import { AccountMenu } from '../../../shared/components/account-menu/account-menu';
import { ProjectStore } from '../projects/project.store';
import { CanvasSnapshotCache } from '../workspace/virtual-device/services/canvas-snapshot-cache';
import { SerialSessionStore } from '../workspace/firmware/serial-session.store';
import { MonacoModelCache } from '../workspace/monaco-model.cache';
import { AiProfilesStore } from '../../../core/services/ai-profiles.store';
import { ProjectAiChatStore } from '../workspace/project-ai-chat.store';
import { DashboardViewCache } from '../workspace/dashboard-builder/dashboard-view.cache';
import { WorkspaceFileBuffers } from '../workspace/workspace-file-buffers.store';

interface UserNavigationItem {
  label: string;
  icon: 'projects' | 'documents' | 'plan' | 'community' | 'assistant';
  path: string;
}

const NAVIGATION_ITEMS: UserNavigationItem[] = [
  { label: 'โปรเจกต์', icon: 'projects', path: 'projects' },
  { label: 'เอกสารคู่มือ', icon: 'documents', path: 'documents' },
  { label: 'ผู้ช่วย IoT', icon: 'assistant', path: 'assistant' },
  { label: 'ชุมชน', icon: 'community', path: 'community' },
];

const RESOURCE_NAVIGATION_ITEMS = NAVIGATION_ITEMS.filter((item) => item.icon !== 'projects');

@Component({
  selector: 'app-user-shell',
  providers: [SerialSessionStore],
  imports: [FileIcon, AccountAvatar, AccountMenu, NgTemplateOutlet, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './user-shell.html',
  styleUrl: './user-shell.css',
  host: {
    '(document:keydown.escape)': 'closeOverlays()',
  },
})
export class UserShell {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly projectStore = inject(ProjectStore);
  private readonly workspaceContext = inject(WorkspaceContextService);
  private readonly canvasSnapshots = inject(CanvasSnapshotCache);
  private readonly fileBuffers = inject(WorkspaceFileBuffers);
  private readonly aiChat = inject(ProjectAiChatStore);
  private readonly aiProfiles = inject(AiProfilesStore);
  private readonly dashboardViews = inject(DashboardViewCache);
  private readonly editorModels = inject(MonacoModelCache);
  private readonly fileNameInput = viewChild<ElementRef<HTMLInputElement>>('fileNameInput');

  protected readonly navigationItems = computed(() => {
    const inProject = this.inProjectWorkspace();
    const basePath = inProject ? this.workspaceBasePath() : '/user';
    const items = inProject ? RESOURCE_NAVIGATION_ITEMS : NAVIGATION_ITEMS;
    return items.map((item) => ({ ...item, path: `${basePath}/${item.path}` }));
  });
  protected readonly user = this.authService.currentUser;
  protected readonly mobileNavigationOpen = signal(false);
  protected readonly loggingOut = signal(false);
  protected readonly currentUrl = signal(this.router.url);
  protected readonly newFileName = signal('');
  protected readonly newFileError = signal('');

  protected readonly projectId = computed(() => {
    const match = this.currentUrl().match(/^\/user\/projects\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  });
  protected readonly activeProject = computed(() =>
    this.projectStore.projectById(this.projectId()),
  );
  protected readonly inProjectWorkspace = computed(() => Boolean(this.projectId()));
  /**
   * Inside a project whose row has not arrived yet.
   *
   * The name and the board are unknown at that moment, not defaults: printing "โปรเจกต์ IoT"
   * puts a project name on screen that no project has, and it is replaced a moment later,
   * which is exactly the flicker a skeleton exists to prevent.
   */
  protected readonly projectPending = computed(
    () => Boolean(this.projectId()) && !this.activeProject(),
  );
  protected readonly fileDialogOpen = computed(() => {
    const projectId = this.projectId();
    return projectId !== null && this.projectStore.fileCreationRequest() === projectId;
  });
  protected readonly workspaceBasePath = computed(() =>
    this.projectId() ? `/user/projects/${encodeURIComponent(this.projectId()!)}` : '/user/projects',
  );

  protected readonly username = computed(() => this.authService.accountDisplayName() ?? 'บัญชีของคุณ');
  protected readonly initials = computed(() =>
    this.username().trim().slice(0, 2).toUpperCase().padEnd(2, 'U'),
  );

  constructor() {
    void this.projectStore.load();

    effect(() => {
      if (!this.fileDialogOpen()) return;
      if (!this.newFileName()) {
        const extension =
          this.activeProject()?.framework === 'MicroPython'
            ? 'py'
            : this.activeProject()?.framework === 'PlatformIO'
              ? 'cpp'
              : 'ino';
        this.newFileName.set(`untitled.${extension}`);
      }
      setTimeout(() => this.fileNameInput()?.nativeElement.focus());
    });

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.currentUrl.set(event.urlAfterRedirects));

    if (!this.user()) {
      this.authService.getCurrentUser().subscribe({ error: () => undefined });
    }
  }

  protected updateNewFileName(event: Event): void {
    this.newFileName.set((event.target as HTMLInputElement).value);
    this.newFileError.set('');
  }

  protected submitNewFile(): void {
    const projectId = this.projectId();
    const filename = this.newFileName().trim();
    if (!projectId) return;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/.test(filename)) {
      this.newFileError.set('กรุณากรอกชื่อไฟล์พร้อมนามสกุล เช่น sensors.cpp');
      return;
    }
    if (this.activeProject()?.files.some((file) => file.toLowerCase() === filename.toLowerCase())) {
      this.newFileError.set('มีไฟล์ชื่อนี้อยู่แล้ว กรุณาใช้ชื่ออื่น');
      return;
    }

    this.projectStore.registerFile(projectId, filename);
    this.closeFileDialog();
    void this.router.navigate([this.workspaceBasePath(), 'ide'], {
      queryParams: { file: filename },
    });
  }

  protected closeFileDialog(): void {
    this.projectStore.clearFileCreationRequest();
    this.newFileName.set('');
    this.newFileError.set('');
  }

  protected toggleMobileNavigation(): void {
    this.mobileNavigationOpen.update((open) => !open);
  }

  protected closeMobileNavigation(): void {
    this.mobileNavigationOpen.set(false);
  }

  protected closeOverlays(): void {
    this.mobileNavigationOpen.set(false);
    this.closeFileDialog();
  }

  protected logout(): void {
    if (this.loggingOut()) return;

    this.loggingOut.set(true);
    this.authService.logout().subscribe({
      next: () => this.finishLogout(),
      error: () => this.finishLogout(),
    });
  }

  private finishLogout(): void {
    this.projectStore.reset();
    this.workspaceContext.reset();
    this.canvasSnapshots.clear();
    // Source text is user data: the next account must not see it in the editor.
    this.fileBuffers.reset();
    this.editorModels.clear();
    // Conversations and profiles are the account's own.
    this.aiChat.reset();
    this.aiProfiles.reset();
    this.dashboardViews.clear();
    this.loggingOut.set(false);
    void this.router.navigateByUrl('/auth/login');
  }
}
