import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'admin/dashboard' },
  {
    path: 'auth/login',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login)
  },
  {
    path: 'auth/signup',
    loadComponent: () => import('./features/auth/signup/signup').then((m) => m.Signup)
  },
  {
    path: 'admin',
    loadComponent: () => import('./features/admin/admin-shell/admin-shell').then((m) => m.AdminShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/admin/dashboard/dashboard.page').then((m) => m.DashboardPage)
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./features/admin/user-management/user-management.page').then((m) => m.UserManagementPage)
      },
      {
        path: 'devices',
        loadComponent: () =>
          import('./features/admin/device-management/device-management.page').then((m) => m.DeviceManagementPage)
      },
      {
        path: 'projects',
        loadComponent: () =>
          import('./features/admin/project-management/project-management.page').then((m) => m.ProjectManagementPage)
      },
      {
        path: 'documents',
        loadComponent: () =>
          import('./features/admin/document-management/document-management.page').then((m) => m.DocumentManagementPage)
      },
      {
        path: 'plans',
        loadComponent: () =>import('./features/admin/plan-management/plan-management.page').then((m) => m.PlanManagementPage)
      },
      {
        path: 'quotas',
        loadComponent: () =>import('./features/admin/quota-management/quota-management.page').then((m) => m.QuotaManagementPage)
      },
      {
        path: 'ai-assistant',
        loadComponent: () =>import('./features/admin/ai-assistant/ai-assistant.page').then((m) => m.AiAssistantPage)
      },
      {
        path: 'server',
        loadComponent: () =>import('./features/admin/server-monitoring/server-monitoring.page').then((m) => m.ServerMonitoringPage)
      },
      {
        path: 'services',
        loadComponent: () => import('./features/admin/services/services.page').then((m) => m.ServicesPage)
      },
      {
        path: 'websites',
        loadComponent: () => import('./features/admin/websites/websites.page').then((m) => m.WebsitesPage)
      },
      {
        path: 'database',
        loadComponent: () => import('./features/admin/database/database.page').then((m) => m.DatabasePage)
      },
      {
        path: 'redis',
        loadComponent: () => import('./features/admin/redis/redis.page').then((m) => m.RedisPage)
      },
      {
        path: 'backups',
        loadComponent: () =>
          import('./features/admin/database-backup/database-backup.page').then((m) => m.DatabaseBackupPage)
      },
      {
        path: 'deployments',
        loadComponent: () => import('./features/admin/deployments/deployments.page').then((m) => m.DeploymentsPage)
      },
      {
        path: 'logs',
        loadComponent: () => import('./features/admin/system-logs/system-logs.page').then((m) => m.SystemLogsPage)
      },
      {
        path: 'alerts',
        loadComponent: () => import('./features/admin/alerts/alerts.page').then((m) => m.AlertsPage)
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/admin/settings/settings.page').then((m) => m.SettingsPage)
      },
      {
        path: 'permissions',
        loadComponent: () => import('./features/admin/permissions/permissions.page').then((m) => m.PermissionsPage)
      },
      {
        path: 'api-keys',
        loadComponent: () => import('./features/admin/api-keys/api-keys.page').then((m) => m.ApiKeysPage)
      },
      {
        path: 'subscriptions',
        loadComponent: () =>
          import('./features/admin/subscriptions/subscriptions.page').then((m) => m.SubscriptionsPage)
      },
      {
        path: 'usage',
        loadComponent: () => import('./features/admin/usage/usage.page').then((m) => m.UsagePage)
      },
      {
        path: 'payments',
        loadComponent: () => import('./features/admin/payments/payments.page').then((m) => m.PaymentsPage)
      }
    ]
  }
];
