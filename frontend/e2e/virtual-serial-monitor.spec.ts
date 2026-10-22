import { expect, test } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

test('canvas serial monitor resizes, preserves output on close, and clears explicitly', async ({
  page,
}) => {
  await installAuthenticatedSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const projectId = '22222222-2222-4222-8222-222222222222';
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const userId = '55555555-5555-4555-8555-555555555555';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
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
          name: 'Serial preview',
          slug: 'serial-preview',
          description: '',
          board: 'ESP32 DevKit V1',
          framework: 'Arduino',
          createdAt: '2026-10-10T00:00:00Z',
          updatedAt: '2026-10-10T00:00:00Z',
        },
      ]);
    if (path.endsWith('/components'))
      return json([
        {
          id: '33333333-3333-4333-8333-333333333333',
          definitionId: 'esp32-devkit-v1',
          label: 'ESP32 DevKit V1',
          x: 420,
          y: 210,
          rotation: 0,
          state: {},
        },
      ]);
    if (path.endsWith('/files'))
      return json([
        {
          path: 'src/main.cpp',
          sizeBytes: 100,
          contentHash: 'mock',
          version: 1,
          updatedAt: '2026-10-10T00:00:00Z',
        },
      ]);
    if (path.endsWith('/file'))
      return json({
        path: 'src/main.cpp',
        content:
          'void setup() { Serial.begin(115200); Serial.println("Hello serial"); }\nvoid loop() { delay(1000); }',
        version: 1,
      });
    if (path.endsWith('/usage')) return json({ plan: { code: 'pro', name: 'Pro' }, metrics: [] });
    return json([]);
  });
  await page.goto(`/user/projects/${projectId}/virtual-device`);
  await expect(page.locator('.summary-row')).toContainText('1 placed');
  await page.getByRole('button', { name: 'Toggle serial monitor', exact: true }).click();
  const panel = page.locator('.serial-monitor');
  const handle = page.getByRole('separator', { name: 'ปรับความสูง Serial Monitor' });
  const clear = page.getByRole('button', { name: 'ล้างข้อความ Serial Monitor' });
  await expect(clear).toBeDisabled();
  await page.locator('.nav-start').click();
  await expect(panel.locator('.serial-output')).toContainText('Hello serial');
  const initial = (await panel.boundingBox())!;
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 - 120, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.height).toBe(initial.height + 120);
  await handle.focus();
  await handle.press('ArrowUp');
  await expect.poll(async () => (await panel.boundingBox())!.height).toBe(initial.height + 144);
  await handle.press('ArrowDown');
  const resized = (await panel.boundingBox())!.height;
  await page.getByRole('button', { name: 'ปิด Serial Monitor' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.nav-start')).toContainText('Stop');
  await page.getByRole('button', { name: 'Toggle serial monitor', exact: true }).click();
  await expect.poll(async () => (await panel.boundingBox())!.height).toBe(resized);
  await expect(panel.locator('.serial-output')).toContainText('Hello serial');
  await page.screenshot({ path: '.tmp/virtual-serial-expanded.png', animations: 'disabled' });
  await clear.click();
  await expect(panel.locator('.serial-output')).not.toContainText('Hello serial');
  await expect(clear).toBeDisabled();
  await handle.press('End');
  const canvas = (await page.locator('.canvas-workspace').boundingBox())!;
  expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(canvas.height - 80);
  await handle.press('Home');
  expect((await panel.boundingBox())!.height).toBeLessThan(initial.height);
  await handle.dblclick();
  await expect.poll(async () => (await panel.boundingBox())!.height).toBe(initial.height);
  await page.setViewportSize({ width: 390, height: 600 });
  await handle.press('End');
  await expect
    .poll(async () => {
      const bounds = (await panel.boundingBox())!;
      const parent = (await page.locator('.canvas-workspace').boundingBox())!;
      return bounds.y >= parent.y + 80 && bounds.y + bounds.height <= parent.y + parent.height + 1;
    })
    .toBe(true);
  await expect(clear).toBeInViewport();
  await expect(page.getByRole('button', { name: 'ปิด Serial Monitor' })).toBeInViewport();
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/virtual-serial-mobile.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});
