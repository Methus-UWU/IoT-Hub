import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

export type AdminNavIcon =
  | 'dashboard'
  | 'users'
  | 'devices'
  | 'projects'
  | 'documents'
  | 'plans'
  | 'quotas'
  | 'ai-assistant'
  | 'server'
  | 'services'
  | 'websites'
  | 'database'
  | 'redis'
  | 'backup'
  | 'deployments'
  | 'logs'
  | 'alerts'
  | 'settings'
  | 'permissions'
  | 'api-keys'
  | 'billing';

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
    label: 'Overview',
    items: [{ label: 'Dashboard', path: 'dashboard', icon: 'dashboard' }]
  },
  {
    label: 'Management',
    items: [
      { label: 'Users', path: 'users', icon: 'users' },
      { label: 'Devices', path: 'devices', icon: 'devices' },
      { label: 'Projects', path: 'projects', icon: 'projects' },
      { label: 'Documents', path: 'documents', icon: 'documents' },
      { label: 'Plans', path: 'plans', icon: 'plans' },
      { label: 'Quotas', path: 'quotas', icon: 'quotas' },
      { label: 'AI Assistant', path: 'ai-assistant', icon: 'ai-assistant' }
    ]
  },
  {
    label: 'Server',
    items: [
      { label: 'Server Monitoring', path: 'server', icon: 'server' },
      { label: 'Services', path: 'services', icon: 'services' },
      { label: 'Websites', path: 'websites', icon: 'websites' },
      { label: 'Database', path: 'database', icon: 'database' },
      { label: 'Redis', path: 'redis', icon: 'redis' },
      { label: 'Backups', path: 'backups', icon: 'backup' },
      { label: 'Deployments', path: 'deployments', icon: 'deployments' }
    ]
  },
  {
    label: 'System',
    items: [
      { label: 'Logs', path: 'logs', icon: 'logs' },
      { label: 'Alerts', path: 'alerts', icon: 'alerts' },
      { label: 'Settings', path: 'settings', icon: 'settings' },
      { label: 'Permissions', path: 'permissions', icon: 'permissions' },
      { label: 'API Keys', path: 'api-keys', icon: 'api-keys' }
    ]
  },
  {
    label: 'Billing',
    items: [
      { label: 'Subscriptions', path: 'subscriptions', icon: 'billing' },
      { label: 'Usage', path: 'usage', icon: 'billing' },
      { label: 'Payments', path: 'payments', icon: 'billing' }
    ]
  }
];

@Component({
  selector: 'app-admin-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './admin-shell.html'
})
export class AdminShell {
  protected readonly navGroups = NAV_GROUPS;

  private readonly _sidebarOpen = signal(false);
  protected readonly sidebarOpen = this._sidebarOpen.asReadonly();

  protected toggleSidebar(): void {
    this._sidebarOpen.update((open) => !open);
  }

  protected closeSidebar(): void {
    this._sidebarOpen.set(false);
  }
}
