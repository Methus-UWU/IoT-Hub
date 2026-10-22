import { Routes } from '@angular/router';
import {
  adminRoleGuard,
  authGuard,
  authMatchGuard,
  guestGuard,
  userRoleGuard,
} from './core/guards/auth.guard';

// Reuse the same pages inside and outside a project, keeping its sidebar in place.
const RESOURCE_ROUTES: Routes = [
  {
    path: 'assistant',
    title: 'ผู้ช่วย IoT — IoT Hub',
    loadComponent: () =>
      import('./features/user/assistant/assistant.page').then((m) => m.AssistantPage),
  },
  {
    path: 'community',
    title: 'ชุมชน — IoT Hub',
    loadComponent: () =>
      import('./features/main/community/community-feed.page').then((m) => m.CommunityFeedPage),
  },
  {
    path: 'community/ask',
    title: 'ตั้งกระทู้ — IoT Hub',
    loadComponent: () =>
      import('./features/main/community/ask-question.page').then((m) => m.AskQuestionPage),
  },
  {
    path: 'community/:slug',
    title: 'กระทู้ — IoT Hub',
    loadComponent: () =>
      import('./features/main/community/community-post.page').then((m) => m.CommunityPostPage),
  },
  {
    path: 'documents',
    title: 'Documents — IoT Hub',
    loadComponent: () =>
      import('./features/user/documents/documents.page').then((m) => m.DocumentsPage),
  },
];

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
        pathMatch: 'full',
        redirectTo: '/home',
      },
      {
        // Public by design: a question nobody can read before signing up is not a
        // community. Posting, answering, and voting still need an account, which
        // the API enforces — the guard below only shapes the composer's route.
        path: 'community',
        title: 'ชุมชน — IoT Hub',
        loadComponent: () =>
          import('./features/main/community/community-feed.page').then((m) => m.CommunityFeedPage),
      },
      {
        // Before ':slug', or a visit to /community/ask would be read as a post.
        path: 'community/ask',
        title: 'ตั้งกระทู้ — IoT Hub',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./features/main/community/ask-question.page').then((m) => m.AskQuestionPage),
      },
      {
        path: 'community/:slug',
        title: 'กระทู้ — IoT Hub',
        loadComponent: () =>
          import('./features/main/community/community-post.page').then((m) => m.CommunityPostPage),
      },
      {
        // The same catalog the signed-in shell serves at /user/documents. The page
        // reads no account state, so visitors can browse it before signing up.
        path: 'docs',
        title: 'Documents — IoT Hub',
        loadComponent: () =>
          import('./features/user/documents/documents.page').then((m) => m.DocumentsPage),
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
            path: 'setup',
            title: 'Creating project — IoT Hub',
            loadComponent: () =>
              import('./features/user/workspace/project-setup/project-setup.page').then(
                (m) => m.ProjectSetupPage,
              ),
          },
          {
            path: 'dashboard',
            title: 'Dashboard builder — IoT Hub',
            data: { preload: true },
            loadComponent: () =>
              import('./features/user/workspace/dashboard-builder/dashboard-builder.page').then(
                (m) => m.DashboardBuilderPage,
              ),
          },
          {
            path: 'virtual-device',
            title: 'Virtual device — IoT Hub',
            data: { preload: true },
            loadComponent: () =>
              import('./features/user/workspace/virtual-device/virtual-device.page').then(
                (m) => m.VirtualDevicePage,
              ),
          },
          {
            path: 'ide',
            title: 'IoT IDE — IoT Hub',
            data: { workspaceView: 'ide', preload: true },
            loadComponent: () =>
              import('./features/user/workspace/project-workspace.page').then(
                (m) => m.ProjectWorkspacePage,
              ),
          },
          ...RESOURCE_ROUTES,
        ],
      },
      ...RESOURCE_ROUTES,
      {
        path: 'settings',
        title: 'ตั้งค่าบัญชี — IoT Hub',
        loadComponent: () =>
          import('./features/account/profile/profile.page').then((m) => m.ProfilePage),
      },
      {
        path: 'plan',
        pathMatch: 'full',
        redirectTo: '/user/projects',
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
        title: 'ภาพรวมระบบ — IoT Hub Admin',
        loadComponent: () =>
          import('./features/admin/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'server',
        title: 'สถานะเซิร์ฟเวอร์ — IoT Hub Admin',
        loadComponent: () =>
          import('./features/admin/server-monitoring/server-monitoring.page').then(
            (m) => m.ServerMonitoringPage,
          ),
      },
      {
        path: 'database',
        title: 'สถานะฐานข้อมูล — IoT Hub Admin',
        loadComponent: () =>
          import('./features/admin/database/database.page').then((m) => m.DatabasePage),
      },
      {
        path: 'logs',
        title: 'บันทึกคำขอ — IoT Hub Admin',
        loadComponent: () =>
          import('./features/admin/system-logs/system-logs.page').then((m) => m.SystemLogsPage),
      },
      {
        path: 'users',
        title: 'จัดการผู้ใช้ — IoT Hub Admin',
        loadComponent: () =>
          import('./features/admin/user-management/user-management.page').then(
            (m) => m.UserManagementPage,
          ),
      },
      {
        path: 'integrations',
        title: 'จัดการ AI — IoT Hub Admin',
        loadComponent: () =>
          import('./features/admin/integrations/integrations.page').then((m) => m.IntegrationsPage),
      },
      {
        path: 'ai-assistant',
        title: 'ผู้ช่วย AI — IoT Hub Admin',
        loadComponent: () =>
          import('./features/admin/ai-assistant/ai-assistant.page').then((m) => m.AiAssistantPage),
      },
      {
        path: 'profile',
        title: 'โปรไฟล์ — IoT Hub Admin',
        loadComponent: () =>
          import('./features/account/profile/profile.page').then((m) => m.ProfilePage),
      },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
