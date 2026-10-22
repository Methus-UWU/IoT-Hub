import { expect, test, type Page } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

const projectId = '33333333-3333-4333-8333-333333333333';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '55555555-5555-4555-8555-555555555555';

interface ServerState {
  content: string;
  version: number;
  listReads: number;
  fileReads: number;
  puts: number;
  /** Holds the AI apply response until the test releases it. */
  releaseApply?: () => void;
}

const AI_CODE = 'void setup() {}\nvoid loop() {\n  // written by the assistant\n}';

async function prepare(page: Page): Promise<ServerState> {
  const server: ServerState = {
    content: 'void setup() {}\nvoid loop() {}',
    version: 1,
    listReads: 0,
    fileReads: 0,
    puts: 0,
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
          name: 'Navigation project',
          slug: 'navigation-project',
          description: '',
          board: 'ESP32 DevKit V1',
          framework: 'Arduino',
          createdAt: '2026-10-03T00:00:00Z',
          updatedAt: '2026-10-03T00:00:00Z',
        },
      ]);
    if (path.endsWith('/files')) {
      server.listReads++;
      return json([
        {
          path: 'src/main.cpp',
          sizeBytes: server.content.length,
          contentHash: 'mock',
          version: server.version,
          updatedAt: '2026-10-03T00:00:00Z',
        },
      ]);
    }
    if (path.endsWith('/file') && request.method() === 'GET') {
      server.fileReads++;
      return json({ path: 'src/main.cpp', content: server.content, version: server.version });
    }
    if (path.endsWith('/file') && request.method() === 'PUT') {
      const body = request.postDataJSON() as { content: string; expectedVersion?: number };
      if (body.expectedVersion !== server.version) {
        return json({ error: { code: 'FILE_VERSION_CONFLICT' } }, 409);
      }
      server.puts++;
      server.content = body.content;
      server.version++;
      return json({ path: 'src/main.cpp', version: server.version });
    }
    if (path.endsWith('/ai/chat')) {
      return json({
        id: 'turn',
        model: 'e2e',
        vendor: 'test',
        profile: 'balanced',
        autoSelected: false,
        content: 'Rewrote the loop.',
        createdAt: '2026-10-03T00:00:00Z',
        plan: {
          actions: [{ type: 'write_file', path: 'src/main.cpp', content: AI_CODE, created: false }],
          preview: [{ kind: 'code', text: 'Modify src/main.cpp' }],
          warnings: [],
        },
      });
    }
    if (path.endsWith('/ai/apply')) {
      await new Promise<void>((resolve) => (server.releaseApply = resolve));
      server.content = AI_CODE;
      server.version++;
      return json({
        componentsAdded: 0,
        createdComponentIds: [],
        connectionsAdded: 0,
        connectionsRemoved: 0,
        filesWritten: ['src/main.cpp'],
      });
    }
    if (path.endsWith('/usage')) return json({ plan: { code: 'pro', name: 'Pro' }, metrics: [] });
    return json([]);
  });
  return server;
}

const editorText = (page: Page) => page.locator('.editor-content .view-lines');

test('code stays on screen and unsaved edits survive leaving and returning to the IDE', async ({
  page,
}) => {
  const server = await prepare(page);
  await page.goto(`/user/projects/${projectId}/ide`);
  await expect(editorText(page)).toContainText('void setup()');
  expect(server.listReads).toBe(1);
  expect(server.fileReads).toBe(1);

  // Type, then leave before the 1.2 s autosave would have fired.
  await page.locator('.editor-content .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n// typed before leaving');
  await page.getByRole('link', { name: 'อุปกรณ์จำลอง' }).click();
  await expect(page).toHaveURL(/virtual-device/);

  // Leaving flushed the pending autosave instead of dropping it.
  await expect.poll(() => server.content).toContain('// typed before leaving');

  await page.getByRole('link', { name: 'ซอร์สโค้ด' }).click();
  await expect(page).toHaveURL(/\/ide/);
  // The code is there on return, with no skeleton and no second round of reads.
  await expect(page.locator('.editor-skeleton')).toHaveCount(0);
  await expect(editorText(page)).toContainText('// typed before leaving');
  expect(server.listReads).toBe(1);
  expect(server.fileReads).toBe(1);
});

test('compile wording replaces build in the IDE', async ({ page }) => {
  await prepare(page);
  await page.goto(`/user/projects/${projectId}/ide`);
  await expect(page.locator('.deploy-button')).toHaveText(/Compile/);
  await expect(page.getByRole('tab', { name: /Compile output/ })).toBeVisible();
});

test('applying AI code shows a skeleton over the file being rewritten, then the new code', async ({
  page,
}) => {
  const server = await prepare(page);
  await page.goto(`/user/projects/${projectId}/ide`);
  await expect(editorText(page)).toContainText('void setup()');
  await page.locator('#ai-prompt').fill('Rewrite the loop');
  await page.locator('#ai-prompt').press('Enter');
  await expect(page.getByText('Rewrote the loop.')).toBeVisible();
  await page.locator('.ai-plan-actions button').first().click();

  await expect(page.locator('.editor-skeleton')).toBeVisible();
  await expect(page.locator('.editor-applying')).toContainText('AI กำลังเขียนโค้ดใหม่');
  await expect.poll(() => Boolean(server.releaseApply)).toBe(true);
  server.releaseApply!();

  await expect(editorText(page)).toContainText('written by the assistant');
  await expect(page.locator('.editor-skeleton')).toHaveCount(0);
  await expect(page.locator('.editor-applying')).toHaveCount(0);
});
