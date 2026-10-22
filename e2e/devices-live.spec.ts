import { expect, test, type Page } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

const projectId = '12121212-1212-4121-8121-121212121212';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '55555555-5555-4555-8555-555555555555';
const deviceId = '34343434-3434-4343-8343-343434343434';
const token = 'iot_abcdefghijklmnopqrstuvwxyz012345';

function layouts(x: number) {
  return {
    desktop: { x, y: 0, cols: 3, rows: 3 },
    tablet: { x: 0, y: x, cols: 3, rows: 3 },
    mobile: { x: 0, y: x, cols: 4, rows: 3 },
  };
}

function widget(id: string, type: string, title: string, datasource: string, x: number) {
  return {
    id,
    type,
    title,
    subtitle: '',
    deviceId: '',
    datasource,
    state: 'pending',
    layouts: layouts(x),
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

interface Server {
  devices: {
    id: string;
    name: string;
    tokenHint: string;
    lastSeenAt: string | null;
    online: boolean;
    createdAt: string;
  }[];
  controls: { key: string; value: unknown }[];
  puts: unknown[];
  relay: boolean;
}

async function prepare(page: Page): Promise<Server> {
  const server: Server = {
    devices: [
      {
        id: deviceId,
        name: 'Living Room ESP32',
        tokenHint: '2345',
        lastSeenAt: '2026-10-11T00:00:00Z',
        online: true,
        createdAt: '2026-10-11T00:00:00Z',
      },
    ],
    controls: [],
    puts: [],
    relay: false,
  };
  await installAuthenticatedSession(page);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
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
    if (path.endsWith('/dashboard') && method === 'GET')
      return json({
        version: 1,
        name: 'Greenhouse',
        document: {
          schemaVersion: 1,
          dashboardId: 'dashboard',
          name: 'Greenhouse',
          deviceScope: deviceId,
          dateRange: '24h',
          widgets: [
            widget('gauge', 'gauge', 'Air temperature', 'temperature', 0),
            widget('relay', 'switch', 'Pump relay', 'relay', 3),
            widget('history', 'line-chart', 'Temperature history', 'temperature', 6),
          ],
        },
        templateId: null,
        templateVersion: null,
        datastreams: [
          {
            id: 't',
            key: 'temperature',
            name: 'Temperature',
            dataType: 'number',
            unit: '°C',
            min: null,
            max: null,
            source: '',
            componentId: null,
          },
          {
            id: 'r',
            key: 'relay',
            name: 'Relay',
            dataType: 'boolean',
            unit: '',
            min: null,
            max: null,
            source: '',
            componentId: null,
          },
        ],
      });
    if (path.endsWith('/dashboard') && method === 'PUT') {
      server.puts.push(request.postDataJSON());
      return json({}, 500);
    }
    const devices = `/api/workspaces/${workspaceId}/projects/${projectId}/devices`;
    if (path === devices && method === 'GET') return json(server.devices);
    if (path === devices && method === 'POST') {
      const created = {
        id: '56565656-5656-4565-8565-565656565656',
        name: (request.postDataJSON() as { name: string }).name,
        tokenHint: token.slice(-4),
        lastSeenAt: null,
        online: false,
        createdAt: '2026-10-11T00:00:00Z',
      };
      server.devices.push(created);
      return json({ device: created, token });
    }
    if (path === `${devices}/${deviceId}/values`)
      return json({
        deviceId,
        online: true,
        lastSeenAt: '2026-10-11T00:00:00Z',
        values: {
          temperature: { value: 27.3, source: 'device', updatedAt: '2026-10-11T00:00:00Z' },
          relay: { value: server.relay, source: 'app', updatedAt: '2026-10-11T00:00:00Z' },
        },
      });
    if (path === `${devices}/${deviceId}/series`)
      return json({
        key: url.searchParams.get('key'),
        range: url.searchParams.get('range'),
        points: [21, 22.5, 24, 27.3].map((value, index) => ({
          at: `2026-10-11T0${index}:00:00Z`,
          value,
        })),
      });
    if (path.startsWith(`${devices}/${deviceId}/values/`) && method === 'PUT') {
      const key = path.split('/').at(-1)!;
      const value = (request.postDataJSON() as { value: unknown }).value;
      server.controls.push({ key, value });
      if (key === 'relay') server.relay = value === true;
      return json({ key, value });
    }
    if (path.endsWith('/components')) return json([]);
    if (path.endsWith('/usage')) return json({ plan: { code: 'pro', name: 'Pro' }, metrics: [] });
    return json([]);
  });
  return server;
}

test('a new device shows its token once with a sketch that uses it', async ({ page }) => {
  await prepare(page);
  await page.goto(`/user/projects/${projectId}/dashboard`);
  await expect(page.locator('.dashboard-widget')).toHaveCount(3);
  await page.getByRole('button', { name: 'More dashboard actions' }).click();
  await page.getByRole('button', { name: /Devices/ }).click();
  const panel = page.getByRole('dialog', { name: 'Devices' });
  await expect(panel).toContainText('Living Room ESP32');
  await expect(panel).toContainText('Online');

  await panel.getByLabel('เพิ่มบอร์ด').fill('Garage ESP32');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByLabel('Device token')).toHaveValue(token);
  await panel.getByText('ตัวอย่างโค้ด ESP32').click();
  await expect(panel.locator('pre')).toContainText(`DEVICE_TOKEN = "${token}"`);
  await expect(panel.locator('pre')).toContainText('{\\"values\\":{\\"temperature\\":');

  // Closing the panel is the last time the token is shown.
  await panel.getByRole('button', { name: 'ปิด Devices' }).click();
  await page.getByRole('button', { name: 'More dashboard actions' }).click();
  await page.getByRole('button', { name: /Devices/ }).click();
  await expect(
    page.getByRole('dialog', { name: 'Devices' }).getByLabel('Device token'),
  ).toHaveCount(0);
});

test('preview shows the device values and a switch sends a control without saving the layout', async ({
  page,
}) => {
  const server = await prepare(page);
  await page.goto(`/user/projects/${projectId}/dashboard`);
  await expect(page.locator('.dashboard-widget')).toHaveCount(3);

  await page.getByRole('button', { name: 'Preview dashboard' }).click();
  await expect(page.locator('.live-banner')).toContainText('Living Room ESP32 · Online');
  await expect(page.locator('.dashboard-widget').first()).toContainText('27.3°C');
  await expect(page.getByRole('img', { name: /4 readings from 21.0°C to 27.3°C/ })).toBeVisible();

  const toggle = page.getByRole('button', { name: 'Toggle Pump relay' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect.poll(() => server.controls).toEqual([{ key: 'relay', value: true }]);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await page.waitForTimeout(1500);
  expect(server.puts).toEqual([]);
});
