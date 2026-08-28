import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import { FileIcon } from '../../../shared/components/file-icon/file-icon';
import { ProjectStore } from '../projects/project.store';

interface UserNavigationItem {
  label: string;
  icon: 'projects' | 'documents' | 'plan';
  path: string;
}

const NAVIGATION_ITEMS: UserNavigationItem[] = [
  { label: 'Projects', icon: 'projects', path: '/user/projects' },
  { label: 'Documents', icon: 'documents', path: '/user/documents' },
  { label: 'Plan', icon: 'plan', path: '/user/plan' },
];

@Component({
  selector: 'app-user-shell',
  imports: [FileIcon, NgTemplateOutlet, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './user-shell.html',
  styleUrl: './user-shell.css',
  host: {
    '(document:click)': 'handleDocumentClick($event)',
    '(document:keydown.escape)': 'closeOverlays()',
  },
})
export class UserShell {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly projectStore = inject(ProjectStore);
  private readonly accountMenu = viewChild<ElementRef<HTMLElement>>('accountMenu');
  private readonly fileNameInput = viewChild<ElementRef<HTMLInputElement>>('fileNameInput');

  protected readonly navigationItems = NAVIGATION_ITEMS;
  protected readonly user = this.authService.currentUser;
  protected readonly accountMenuOpen = signal(false);
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
  protected readonly fileDialogOpen = computed(() => {
    const projectId = this.projectId();
    return projectId !== null && this.projectStore.fileCreationRequest() === projectId;
  });
  protected readonly workspaceBasePath = computed(() =>
    this.projectId() ? `/user/projects/${encodeURIComponent(this.projectId()!)}` : '/user/projects',
  );

  protected readonly username = computed(() => this.user()?.username ?? 'User');
  protected readonly initials = computed(() =>
    this.username().trim().slice(0, 2).toUpperCase().padEnd(2, 'U'),
  );

  constructor() {
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

  protected toggleAccountMenu(): void {
    this.accountMenuOpen.update((open) => !open);
  }

  protected toggleMobileNavigation(): void {
    this.mobileNavigationOpen.update((open) => !open);
  }

  protected closeMobileNavigation(): void {
    this.mobileNavigationOpen.set(false);
  }

  protected closeOverlays(): void {
    this.accountMenuOpen.set(false);
    this.mobileNavigationOpen.set(false);
    this.closeFileDialog();
  }

  protected handleDocumentClick(event: Event): void {
    if (!this.accountMenu()?.nativeElement.contains(event.target as Node)) {
      this.accountMenuOpen.set(false);
    }
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
    this.loggingOut.set(false);
    void this.router.navigateByUrl('/auth/login');
  }
}
