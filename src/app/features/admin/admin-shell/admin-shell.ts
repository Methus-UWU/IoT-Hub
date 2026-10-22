import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AiProfilesStore } from '../../../core/services/ai-profiles.store';
import { AuthService } from '../../../core/services/auth.service';
import { AccountAvatar } from '../../../shared/components/account-avatar/account-avatar';
import { AccountMenu } from '../../../shared/components/account-menu/account-menu';

export type AdminNavIcon =
  'dashboard' | 'server' | 'database' | 'logs' | 'users' | 'integrations' | 'ai';

interface AdminNavItem {
  label: string;
  path: string;
  icon: AdminNavIcon;
}

interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

const NAV_GROUPS: AdminNavGroup[] = [
  {
    label: 'ภาพรวม',
    items: [{ label: 'แดชบอร์ด', path: 'dashboard', icon: 'dashboard' }],
  },
  {
    label: 'เซิร์ฟเวอร์',
    items: [
      { label: 'สถานะเซิร์ฟเวอร์', path: 'server', icon: 'server' },
      { label: 'ฐานข้อมูล', path: 'database', icon: 'database' },
    ],
  },
  {
    label: 'ระบบ',
    items: [
      { label: 'บันทึกคำขอ', path: 'logs', icon: 'logs' },
      { label: 'ผู้ใช้', path: 'users', icon: 'users' },
      { label: 'จัดการ AI', path: 'integrations', icon: 'integrations' },
      { label: 'ผู้ช่วย AI', path: 'ai-assistant', icon: 'ai' },
    ],
  },
];

@Component({
  selector: 'app-admin-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, AccountAvatar, AccountMenu],
  templateUrl: './admin-shell.html',
  styleUrl: './admin-shell.css',
})
export class AdminShell {
  private readonly authService = inject(AuthService);
  private readonly aiProfiles = inject(AiProfilesStore);
  private readonly router = inject(Router);

  protected readonly navGroups = NAV_GROUPS;
  protected readonly user = this.authService.currentUser;
  protected readonly loggingOut = signal(false);

  protected readonly username = computed(
    () => this.user()?.displayName || this.user()?.username || 'Admin',
  );
  protected readonly profileInitials = computed(() =>
    this.username().trim().slice(0, 2).toUpperCase().padEnd(2, 'A'),
  );
  protected readonly roleLabel = computed(() => {
    const role = this.user()?.role.name.toLowerCase();
    return role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน';
  });

  private readonly _sidebarOpen = signal(false);
  protected readonly sidebarOpen = this._sidebarOpen.asReadonly();

  constructor() {
    this.authService.getCurrentUser().subscribe({ error: () => undefined });
  }

  protected toggleSidebar(): void {
    this._sidebarOpen.update((open) => !open);
  }

  protected closeSidebar(): void {
    this._sidebarOpen.set(false);
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
    this.aiProfiles.reset();
    this.loggingOut.set(false);
    void this.router.navigateByUrl('/auth/login');
  }
}
