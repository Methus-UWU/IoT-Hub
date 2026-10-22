import { expect, test, type Page } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

const projectId = '44444444-4444-4444-8444-444444444444';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '55555555-5555-4555-8555-555555555555';
const templateId = '66666666-6666-4666-8666-666666666666';

function layouts(x = 0) {
  return {
    desktop: { x, y: 0, cols: 3, rows: 3 },
    tablet: { x: 0, y: 0, cols: 3, rows: 3 },
    mobile: { x: 0, y: 0, cols: 4, rows: 3 },
  };
}

function gauge(id: string, title: string, datasource = 'temperature') {
  return {
    id,
    type: 'gauge',
    title,
    subtitle: '',
    deviceId: '',
    datasource,
    state: 'pending',
    layouts: layouts(),
    settings: {
      accent: '#545454',
      background: 'white',
      showHeader: true,
      unit: '°C',
      decimals: 1,
      controlValue: 0,
      locked: false,
    },
  };
}

const temperature = {
  id: '77777777-7777-4777-8777-777777777777',
  key: 'temperature',
  name: 'Temperature',
  dataType: 'number',
  unit: '°C',
  min: null,
  max: null,
  source: 'temperature',
  componentId: null,
};

interface Server {
  version: number;
  document: Record<string, unknown> | null;
  puts: { expectedVersion?: number; document: { name: string; widgets: unknown[] } }[];
  applied: string[];
  releaseLoad?: () => void;
}

async function prepare(page: Page, options: { slowLoad?: boolean } = {}): Promise<Server> {
  const server: Server = { version: 0, document: null, puts: [], applied: [] };
  await installAuthenticatedSession(page);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (url.hostname.endsWith('.supabase.co')) return json({});
    if (!path.startsWith('/api/')) return route.continue();
    if (path === '/api/auth/me')
      return json({
        id: userId,
        username: 'maker',
        email: 'e2e@example.com',
        isActive: true,
        role: { name: 'user' },
      });
    if (path === '/api/workspaces')
      return json([
        { id: workspaceId, name: 'Workspace', slug: 'workspace', ownerId: userId, role: 'owner' },
      ]);
    if (path === `/api/workspaces/${workspaceId}/projects`)
      return json([
        {
          id: projectId,
          workspaceId,
          name: 'Greenhouse',
          slug: 'greenhouse',
          description: '',
          board: 'ESP32 DevKit V1',
          framework: 'Arduino',
          createdAt: '2026-10-03T00:00:00Z',
          updatedAt: '2026-10-03T00:00:00Z',
        },
      ]);
    const view = () => ({
      version: server.version,
      name: (server.document?.['name'] as string) ?? 'Dashboard',
      document: server.document ?? {
        schemaVersion: 1,
        dashboardId: 'dashboard',
        name: 'Dashboard',
        deviceScope: '',
        dateRange: '24h',
        widgets: [],
      },
      templateId: server.applied.at(-1) ?? null,
      templateVersion: server.applied.length ? 1 : null,
      datastreams: [temperature],
    });
    if (path.endsWith('/dashboard') && request.method() === 'GET') {
      if (options.slowLoad) await new Promise<void>((resolve) => (server.releaseLoad = resolve));
      return json(view());
    }
    if (path.endsWith('/dashboard') && request.method() === 'PUT') {
      const body = request.postDataJSON() as Server['puts'][number];
      server.puts.push(body);
      if ((body.expectedVersion ?? 0) !== server.version) {
        return json({ code: 'DASHBOARD_VERSION_CONFLICT', message: 'changed' }, 409);
      }
      server.version++;
      server.document = body.document as Record<string, unknown>;
      return json(view());
    }
    if (path.endsWith('/dashboard/apply-template')) {
      server.applied.push(templateId);
      server.version++;
      server.document = {
        schemaVersion: 1,
        dashboardId: 'dashboard',
        name: 'Smart Home Monitor',
        deviceScope: '',
        dateRange: '24h',
        widgets: [gauge('from-template', 'Living room')],
      };
      return json({ dashboard: view(), warnings: [] });
    }
    if (path.endsWith('/dashboard-templates'))
      return json([
        {
          id: templateId,
          name: 'Smart Home Monitor',
          description: 'Temperature at a glance',
          boardId: 'esp32-devkit-v1',
          visibility: 'workspace',
          latestVersion: 1,
          createdBy: userId,
          updatedAt: '2026-10-03T00:00:00Z',
        },
      ]);
    if (path.endsWith('/components')) return json([]);
    if (path.endsWith('/usage')) return json({ plan: { code: 'pro', name: 'Pro' }, metrics: [] });
    return json([]);
  });
  return server;
}

test('the dashboard loads from the server behind a skeleton and autosaves with its version', async ({
  page,
}) => {
  const server = await prepare(page, { slowLoad: true });
  server.version = 1;
  server.document = {
    schemaVersion: 1,
    dashboardId: 'dashboard',
    name: 'Greenhouse',
    deviceScope: '',
    dateRange: '24h',
    widgets: [gauge('g1', 'Air temperature')],
  };
  await page.goto(`/user/projects/${projectId}/dashboard`);
  await expect(page.locator('.canvas-skeleton')).toBeVisible();
  await expect.poll(() => Boolean(server.releaseLoad)).toBe(true);
  server.releaseLoad!();

  await expect(page.locator('.dashboard-widget')).toHaveCount(1);
  await expect(page.locator('.canvas-skeleton')).toHaveCount(0);
  // Loading is not an edit.
  await page.waitForTimeout(1200);
  expect(server.puts).toHaveLength(0);

  const name = page.getByRole('textbox', { name: 'Dashboard name' });
  await name.fill('Greenhouse live');
  await expect.poll(() => server.puts.length).toBe(1);
  expect(server.puts[0].expectedVersion).toBe(1);
  expect(server.puts[0].document.name).toBe('Greenhouse live');
});

test('a dashboard kept only in this browser is uploaded once, unbound from missing data', async ({
  page,
}) => {
  const server = await prepare(page);
  await page.addInitScript(
    ([id, widget]) =>
      localStorage.setItem(
        `iot-hub:dashboard-builder:${id}:v1`,
        JSON.stringify({
          schemaVersion: 1,
          dashboardId: 'old',
          name: 'Old local',
          deviceScope: 'All devices',
          dateRange: '24h',
          widgets: [widget],
        }),
      ),
    [projectId, { ...gauge('legacy', 'Legacy pump', 'pump_flow'), deviceId: 'pump-controller' }],
  );
  await page.goto(`/user/projects/${projectId}/dashboard`);
  await expect(page.locator('.dashboard-widget')).toHaveCount(1);
  expect(server.puts).toHaveLength(1);
  expect(server.puts[0].expectedVersion).toBeUndefined();
  const widget = server.puts[0].document.widgets[0] as { datasource: string; deviceId: string };
  expect(widget).toMatchObject({ datasource: '', deviceId: '' });
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`iot-hub:dashboard-builder:${id}:v1`),
      projectId,
    ),
  ).toBeNull();
});

test('a template replaces the dashboard after confirmation', async ({ page }) => {
  const server = await prepare(page);
  server.version = 1;
  server.document = {
    schemaVersion: 1,
    dashboardId: 'dashboard',
    name: 'Greenhouse',
    deviceScope: '',
    dateRange: '24h',
    widgets: [gauge('g1', 'Air temperature')],
  };
  await page.goto(`/user/projects/${projectId}/dashboard`);
  await expect(page.locator('.dashboard-widget')).toHaveCount(1);

  await page.getByRole('button', { name: 'More dashboard actions' }).click();
  await page.getByRole('button', { name: /Templates/ }).click();
  const panel = page.getByRole('dialog', { name: 'Dashboard templates' });
  await expect(panel).toContainText('Smart Home Monitor');
  await panel.getByRole('button', { name: 'Use', exact: true }).click();
  await panel.getByRole('button', { name: 'Replace dashboard' }).click();

  await expect(panel).toHaveCount(0);
  expect(server.applied).toEqual([templateId]);
  await expect(page.locator('.dashboard-widget')).toContainText('Living room');
  await page.waitForTimeout(1200);
  expect(server.puts).toHaveLength(0);
});

test('returning to the dashboard draws it at once and still checks the server', async ({
  page,
}) => {
  const server = await prepare(page);
  server.version = 1;
  server.document = {
    schemaVersion: 1,
    dashboardId: 'dashboard',
    name: 'Greenhouse',
    deviceScope: '',
    dateRange: '24h',
    widgets: [gauge('g1', 'Air temperature')],
  };
  let reads = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      /^\/api\/.*\/dashboard$/.test(new URL(request.url()).pathname)
    )
      reads++;
  });
  await page.goto(`/user/projects/${projectId}/dashboard`);
  await expect(page.locator('.dashboard-widget')).toHaveCount(1);

  await page.getByRole('link', { name: 'ซอร์สโค้ด', exact: true }).click();
  await expect(page).toHaveURL(/\/ide/);
  // Someone else saves meanwhile.
  server.version = 2;
  server.document = { ...server.document, widgets: [gauge('g1', 'Soil temperature')] };
  await page.getByRole('link', { name: 'แดชบอร์ด', exact: true }).click();

  // No skeleton: the last known dashboard is drawn first, then the newer one replaces it.
  await expect(page.locator('.canvas-skeleton')).toHaveCount(0);
  await expect(page.locator('.dashboard-widget')).toContainText('Soil temperature');
  expect(reads).toBe(2);
  await page.waitForTimeout(1200);
  expect(server.puts).toHaveLength(0);
});
