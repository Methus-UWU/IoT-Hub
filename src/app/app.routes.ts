import { Routes } from '@angular/router';
import {
  adminRoleGuard,
  authGuard,
  authMatchGuard,
  guestGuard,
  userRoleGuard,
} from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    // Where Supabase returns after an OAuth sign-in or an email confirmation.
    // Deliberately outside the guarded /auth block: the visitor arrives already
    // carrying a session in the URL fragment, and guestGuard would redirect them
    // before the Supabase client had finished reading it.
    path: 'auth/callback',
    title: 'Signing in — IoT Hub',
    loadComponent: () =>
      import('./features/auth/callback/auth-callback').then((m) => m.AuthCallback),
  },
  {
    path: '',
    loadComponent: () => import('./layouts/main-layout').then((m) => m.MainLayout),
    children: [
      {
        path: 'home',
        title: 'IoT Hub — Build Smarter IoT Systems',
        loadComponent: () => import('./features/main/home/home').then((m) => m.Home),
      },
      {
        path: 'pricing',
        title: 'Pricing — IoT Hub',
        loadComponent: () => import('./features/main/pricing/pricing').then((m) => m.Pricing),
      },
    ],
  },
  {
    path: 'auth',
    canActivate: [guestGuard],
    loadComponent: () => import('./layouts/auth-layout').then((m) => m.AuthLayout),
    children: [
      {
        path: 'login',
        title: 'Login — IoT Hub',
        loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
      },
      {
        path: 'signup',
        title: 'Sign Up — IoT Hub',
        loadComponent: () => import('./features/auth/signup/signup').then((m) => m.Signup),
      },
    ],
  },
  {
    path: 'user',
    canMatch: [authMatchGuard],
    canActivate: [authGuard, userRoleGuard],
    loadComponent: () => import('./features/user/user-shell/user-shell').then((m) => m.UserShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'projects' },
      {
        path: 'projects',
        title: 'Projects — IoT Hub',
        loadComponent: () =>
          import('./features/user/projects/projects.page').then((m) => m.ProjectsPage),
      },
      {
        path: 'projects/:projectId',
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'ide' },
          {
            path: 'dashboard',
            title: 'Dashboard builder — IoT Hub',
            loadComponent: () =>
              import('./features/user/workspace/dashboard-builder/dashboard-builder.page').then(
                (m) => m.DashboardBuilderPage,
              ),
          },
          {
            path: 'virtual-device',
            title: 'Virtual device — IoT Hub',
            loadComponent: () =>
              import('./features/user/workspace/virtual-device/virtual-device.page').then(
                (m) => m.VirtualDevicePage,
              ),
          },
          {
            path: 'ide',
            title: 'IoT IDE — IoT Hub',
            data: { workspaceView: 'ide' },
            loadComponent: () =>
              import('./features/user/workspace/project-workspace.page').then(
                (m) => m.ProjectWorkspacePage,
              ),
          },
        ],
      },
      {
        path: 'documents',
        title: 'Documents — IoT Hub',
        loadComponent: () =>
          import('./features/user/documents/documents.page').then((m) => m.DocumentsPage),
      },
      {
        path: 'plan',
        title: 'Plan — IoT Hub',
        loadComponent: () => import('./features/user/plan/plan.page').then((m) => m.PlanPage),
      },
    ],
  },
  {
    path: 'admin',
    canMatch: [authMatchGuard],
    canActivate: [authGuard, adminRoleGuard],
    loadComponent: () =>
      import('./features/admin/admin-shell/admin-shell').then((m) => m.AdminShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/admin/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'server',
        loadComponent: () =>
          import('./features/admin/server-monitoring/server-monitoring.page').then(
            (m) => m.ServerMonitoringPage,
          ),
      },
      {
        path: 'database',
        loadComponent: () =>
          import('./features/admin/database/database.page').then((m) => m.DatabasePage),
      },
      {
        path: 'logs',
        loadComponent: () =>
          import('./features/admin/system-logs/system-logs.page').then((m) => m.SystemLogsPage),
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./features/admin/user-management/user-management.page').then(
            (m) => m.UserManagementPage,
          ),
      },
      {
        path: 'integrations',
        loadComponent: () =>
          import('./features/admin/integrations/integrations.page').then((m) => m.IntegrationsPage),
      },
      {
        path: 'ai-assistant',
        title: 'AI Assistant — IoT Hub Admin',
        loadComponent: () =>
          import('./features/admin/ai-assistant/ai-assistant.page').then((m) => m.AiAssistantPage),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/admin/settings/settings.page').then((m) => m.SettingsPage),
      },
      {
        path: 'profile',
        title: 'โปรไฟล์ — IoT Hub Admin',
        loadComponent: () =>
          import('./features/admin/profile/profile.page').then((m) => m.ProfilePage),
      },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
