import { expect, test, type Page } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

const projectId = '88888888-8888-4888-8888-888888888888';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '55555555-5555-4555-8555-555555555555';

const pubsub = {
  owner: 'knolleary',
  name: 'PubSubClient',
  description: 'A client library for MQTT messaging.',
  version: '2.8',
  releasedAt: '2020-05-20T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  popularityRank: 3,
  stars: 3000,
  keywords: ['mqtt'],
};

interface ServerState {
  files: string[];
  listReads: number;
  searches: URLSearchParams[];
  installs: unknown[];
  removed: string[];
  releaseSearch?: () => void;
}

async function prepare(page: Page): Promise<ServerState> {
  const server: ServerState = {
    // A library installed earlier: its files are on the server but never tabs.
    files: ['src/main.cpp', 'lib/Old/library-source.json', 'lib/Old/Old.h'],
    listReads: 0,
    searches: [],
    installs: [],
    removed: [],
  };
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
          name: 'MQTT sensor',
          slug: 'mqtt-sensor',
          description: '',
          board: 'ESP32 DevKit V1',
          framework: 'Arduino',
          createdAt: '2026-10-03T00:00:00Z',
          updatedAt: '2026-10-03T00:00:00Z',
        },
      ]);
    if (path === '/api/libraries/search') {
      server.searches.push(url.searchParams);
      if (server.searches.length === 1) {
        await new Promise<void>((resolve) => (server.releaseSearch = resolve));
      }
      return json({ total: 1, page: 1, items: [pubsub] });
    }
    const libraries = `/api/workspaces/${workspaceId}/projects/${projectId}/libraries`;
    if (path === libraries && request.method() === 'GET') {
      const installed = server.files.includes('lib/PubSubClient/library-source.json');
      return json(
        installed
          ? [
              {
                folder: 'PubSubClient',
                owner: 'knolleary',
                name: 'PubSubClient',
                version: '2.8',
                installedAt: '2026-10-11T00:00:00Z',
                fileCount: 3,
                sizeBytes: 34114,
              },
            ]
          : [],
      );
    }
    if (path === libraries && request.method() === 'POST') {
      server.installs.push(request.postDataJSON());
      server.files.push(
        'lib/PubSubClient/library-source.json',
        'lib/PubSubClient/src/PubSubClient.h',
        'lib/PubSubClient/src/PubSubClient.cpp',
      );
      return json({
        installed: [
          { folder: 'PubSubClient', owner: 'knolleary', name: 'PubSubClient', version: '2.8' },
        ],
        skipped: [],
      });
    }
    if (path === `${libraries}/PubSubClient` && request.method() === 'DELETE') {
      server.removed.push('PubSubClient');
      server.files = server.files.filter((file) => !file.startsWith('lib/PubSubClient/'));
      return json({ removed: 3 });
    }
    if (path.endsWith('/files')) {
      server.listReads++;
      return json(
        server.files.map((file) => ({
          path: file,
          sizeBytes: 10,
          contentHash: 'mock',
          version: 1,
          updatedAt: '2026-10-03T00:00:00Z',
        })),
      );
    }
    if (path.endsWith('/file') && request.method() === 'GET') {
      return json({
        path: url.searchParams.get('path'),
        content: 'void setup() {}\nvoid loop() {}',
        version: 1,
      });
    }
    if (path.endsWith('/usage')) return json({ plan: { code: 'pro', name: 'Pro' }, metrics: [] });
    return json([]);
  });
  return server;
}

test('a registry library installs into lib/, reloads the file list, and stays out of the tabs', async ({
  page,
}) => {
  const server = await prepare(page);
  await page.goto(`/user/projects/${projectId}/ide`);
  await expect(page.getByRole('tab', { name: /main\.cpp/ })).toBeVisible();
  await expect(page.locator('.editor-tab')).toHaveCount(1);

  await page.getByRole('button', { name: 'More workspace actions' }).click();
  await page.getByRole('menuitem', { name: 'Libraries' }).click();
  const dialog = page.getByRole('dialog', { name: 'Library Manager' });
  await expect(dialog.locator('.row-skeleton').first()).toBeVisible();
  await expect.poll(() => Boolean(server.releaseSearch)).toBe(true);
  server.releaseSearch!();

  await expect(dialog).toContainText('PubSubClient');
  // The ESP32 board narrows the registry to libraries for its platform.
  expect(server.searches[0].get('platform')).toBe('espressif32');
  expect(server.searches[0].get('sort')).toBe('popularity');

  await dialog.getByLabel('เรียงผลลัพธ์').selectOption('updated');
  await expect.poll(() => server.searches.at(-1)?.get('sort')).toBe('updated');

  const listsBefore = server.listReads;
  await dialog.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('ติดตั้ง PubSubClient 2.8 แล้ว');
  expect(server.installs).toEqual([{ owner: 'knolleary', name: 'PubSubClient' }]);
  await expect.poll(() => server.listReads).toBeGreaterThan(listsBefore);
  await expect(dialog).toContainText('ติดตั้งแล้ว v2.8');

  await dialog.getByRole('tab', { name: /Installed/ }).click();
  await expect(dialog).toContainText('lib/PubSubClient');
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await dialog.getByRole('button', { name: 'ยืนยันลบ' }).click();
  await expect(dialog.getByRole('status')).toContainText('ลบ PubSubClient');
  expect(server.removed).toEqual(['PubSubClient']);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Library files never became editor tabs.
  await expect(page.locator('.editor-tab')).toHaveCount(1);
});
