import { expect, test, type Route } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const boardId = '33333333-3333-4333-8333-333333333333';
const sensorId = '44444444-4444-4444-8444-444444444444';

interface ComponentRecord {
  id: string;
  definitionId: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  state: Record<string, unknown>;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}


test('AI datasheet plan adds, wires, simulates, saves, and reloads a circuit', async ({ page }) => {
  await installAuthenticatedSession(page);

  const components: ComponentRecord[] = [{
    id: boardId,
    definitionId: 'esp32-devkit-v1',
    label: 'ESP32 DevKit V1',
    x: 420,
    y: 210,
    rotation: 0,
    state: {},
  }];
  const connections: Record<string, unknown>[] = [];
  let datasheetPromptSeen = false;
  let planApplied = false;

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname.endsWith('.supabase.co')) {
      if (url.pathname.endsWith('/auth/v1/user')) {
        return json(route, { id: '55555555-5555-4555-8555-555555555555', email: 'e2e@example.com' });
      }
      return json(route, {});
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();

    const path = url.pathname;
    if (path === '/api/auth/me') {
      return json(route, { id: '55555555-5555-4555-8555-555555555555', username: 'e2e', email: 'e2e@example.com', isActive: true, role: { name: 'user' } });
    }
    if (path === '/api/workspaces') {
      return json(route, [{ id: workspaceId, name: 'E2E workspace', slug: 'e2e', ownerId: '55555555-5555-4555-8555-555555555555', role: 'owner' }]);
    }
    if (path === `/api/workspaces/${workspaceId}/projects`) {
      return json(route, [{ id: projectId, workspaceId, name: 'Datasheet circuit', slug: 'datasheet-circuit', description: 'Read the sensor datasheet and build a safe circuit', board: 'ESP32 DevKit V1', framework: 'Arduino', createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z' }]);
    }
    if (path.endsWith('/usage')) {
      return json(route, { plan: { code: 'pro', name: 'Pro' }, metrics: [] });
    }
    if (path.endsWith('/components')) {
      if (request.method() === 'GET') return json(route, components);
      return json(route, {});
    }
    if (path.endsWith('/connections')) {
      if (request.method() === 'GET') return json(route, connections);
      return json(route, {});
    }
    if (path.endsWith('/files')) {
      return json(route, [{ path: 'src/main.ino', sizeBytes: 86, contentHash: 'e2e', version: 1, updatedAt: '2026-09-26T00:00:00.000Z' }]);
    }
    if (path.endsWith('/file')) {
      return json(route, { path: 'src/main.ino', content: 'void setup() {}\nvoid loop() {}\n', sizeBytes: 33, contentHash: 'e2e', version: 1, updatedAt: '2026-09-26T00:00:00.000Z' });
    }
    if (path.endsWith('/ai/chat')) {
      const body = request.postDataJSON() as { messages?: { content: string }[] };
      datasheetPromptSeen = body.messages?.some((message) => /datasheet/i.test(message.content)) ?? false;
      return json(route, {
        id: 'turn-e2e', model: 'e2e', vendor: 'test', profile: 'balanced', autoSelected: false,
        content: 'I read the DHT22 datasheet: use 3.3 V, common ground, and a 4.7 kΩ pull-up on DATA.',
        createdAt: '2026-09-26T00:00:00.000Z',
        plan: {
          actions: [
            { type: 'add_device', ref: 'sensor', definitionId: 'dht22', label: 'Room DHT22' },
            { type: 'connect', from: { componentId: boardId, pinId: '3V3' }, to: { componentId: 'sensor', pinId: 'VCC' }, kind: 'power', color: '#ef4444' },
            { type: 'connect', from: { componentId: boardId, pinId: 'GND-L' }, to: { componentId: 'sensor', pinId: 'GND' }, kind: 'ground', color: '#111827' },
            { type: 'connect', from: { componentId: boardId, pinId: 'GPIO4' }, to: { componentId: 'sensor', pinId: 'DATA' }, kind: 'signal', color: '#22c55e' },
          ],
          preview: [{ kind: 'device', text: 'Add DHT22 after reading its datasheet' }, { kind: 'wiring', text: 'Wire power, ground, and DATA safely' }],
          warnings: [],
        },
      });
    }
    if (path.endsWith('/ai/apply')) {
      planApplied = true;
      if (!components.some((component) => component.id === sensorId)) {
        components.push({ id: sensorId, definitionId: 'dht22', label: 'Room DHT22', x: 700, y: 260, rotation: 0, state: { temperature: 24, humidity: 50 } });
        connections.push(
          { id: 'wire-vcc', from: { componentId: boardId, pinId: '3V3' }, to: { componentId: sensorId, pinId: 'VCC' }, color: '#ef4444', kind: 'power', waypoints: [] },
          { id: 'wire-gnd', from: { componentId: boardId, pinId: 'GND-L' }, to: { componentId: sensorId, pinId: 'GND' }, color: '#111827', kind: 'ground', waypoints: [] },
          { id: 'wire-data', from: { componentId: boardId, pinId: 'GPIO4' }, to: { componentId: sensorId, pinId: 'DATA' }, color: '#22c55e', kind: 'signal', waypoints: [] },
        );
      }
      return json(route, { componentsAdded: 1, createdComponentIds: [sensorId], connectionsAdded: 3, connectionsRemoved: 0, filesWritten: [] });
    }
    if (request.method() === 'PATCH' || request.method() === 'PUT' || request.method() === 'DELETE') return json(route, {});
    return json(route, []);
  });

  await page.goto(`/user/projects/${projectId}/ide`);
  await expect(page.locator('#ai-prompt')).toBeVisible();
  await page.locator('#ai-prompt').fill('Read the DHT22 datasheet, add it, and wire it safely');
  await page.locator('#ai-prompt').press('Enter');
  await expect(page.getByText('I read the DHT22 datasheet', { exact: false })).toBeVisible();
  await page.locator('.ai-plan-actions button').first().click();
  await expect.poll(() => planApplied).toBe(true);
  expect(datasheetPromptSeen).toBe(true);

  await page.goto(`/user/projects/${projectId}/virtual-device`);
  await expect(page.locator('.part-list')).toContainText('DHT22');
  await expect(page.locator('.summary-row')).toContainText('2 placed');
  await expect(page.locator('.summary-row')).toContainText('3 wires');
  await page.locator('.nav-start').click();
  await expect(page.locator('.summary-row')).toContainText('Simulation online');
  await page.locator('.nav-start').click();

  await page.reload();
  await expect(page.locator('.part-list')).toContainText('DHT22');
  await expect(page.locator('.summary-row')).toContainText('2 placed');
  await expect(page.locator('.summary-row')).toContainText('3 wires');
});
