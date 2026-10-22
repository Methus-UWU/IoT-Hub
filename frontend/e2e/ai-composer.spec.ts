import { expect, test } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

test('Enter and click accept a draft before diagnostics, without resubmitting or losing the next draft', async ({
  page,
}) => {
  await installAuthenticatedSession(page);
  const projectId = '22222222-2222-4222-8222-222222222222';
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const userId = '55555555-5555-4555-8555-555555555555';
  let diagnosticsGate: Promise<void> | null = null;
  let waitingForDiagnostics = 0;
  const sent: string[] = [];
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
          name: 'Composer preview',
          slug: 'composer-preview',
          description: '',
          board: 'ESP32 DevKit V1',
          framework: 'Arduino',
          createdAt: '2026-10-10T00:00:00Z',
          updatedAt: '2026-10-10T00:00:00Z',
        },
      ]);
    if (path.endsWith('/components') && diagnosticsGate) {
      waitingForDiagnostics++;
      await diagnosticsGate;
      return json([]);
    }
    if (path.endsWith('/files'))
      return json([
        {
          path: 'src/main.cpp',
          sizeBytes: 29,
          contentHash: 'mock',
          version: 1,
          updatedAt: '2026-10-10T00:00:00Z',
        },
      ]);
    if (path.endsWith('/file'))
      return json({ path: 'src/main.cpp', content: 'void setup() {}\nvoid loop() {}', version: 1 });
    if (path.endsWith('/usage')) return json({ plan: { code: 'pro', name: 'Pro' }, metrics: [] });
    if (path.endsWith('/ai/chat')) {
      const body = route.request().postDataJSON() as { messages: { content: string }[] };
      sent.push(body.messages.at(-1)!.content);
      return json({
        content: 'ตัวอย่างผลลัพธ์\n\n```text\nHello from test.cpp\nHello from ESP32\n```',
      });
    }
    return json([]);
  });
  await page.goto(`/user/projects/${projectId}/ide`);
  const prompt = page.locator('#ai-prompt');
  const send = page.getByRole('button', { name: 'ส่งข้อความ', exact: true });
  await expect(prompt).toBeVisible();
  await prompt.fill('บรรทัดแรก');
  await prompt.press('Shift+Enter');
  await prompt.press('a');
  await expect(prompt).toHaveValue('บรรทัดแรก\na');
  await prompt.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await prompt.dispatchEvent('keydown', { key: 'Enter', repeat: true });
  await expect(prompt).toHaveValue('บรรทัดแรก\na');
  expect(sent).toEqual([]);

  for (const mode of ['enter', 'click'] as const) {
    let release = () => {};
    diagnosticsGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    waitingForDiagnostics = 0;
    const text = `ส่งด้วย ${mode}`;
    const countBefore = sent.length;
    try {
      await prompt.fill(text);
      if (mode === 'enter') await prompt.press('Enter');
      else await send.click();
      // The UI must acknowledge submission while the diagnostics request is still held.
      await expect(prompt).toHaveValue('');
      await expect(page.locator('.user-message').last()).toContainText(text);
      await expect(send).toBeDisabled();
      await expect.poll(() => waitingForDiagnostics).toBeGreaterThan(0);
      expect(sent).toHaveLength(countBefore);
      await prompt.fill('ร่างข้อความถัดไป');
      await prompt.press('Enter');
      await prompt.dispatchEvent('keydown', { key: 'Enter', repeat: true });
      await expect(prompt).toHaveValue('ร่างข้อความถัดไป');
    } finally {
      release();
      diagnosticsGate = null;
    }
    await expect(send).toBeEnabled();
    expect(sent).toHaveLength(countBefore + 1);
    expect(sent.at(-1)).toBe(text);
    await expect(prompt).toHaveValue('ร่างข้อความถัดไป');
  }
  const code = page.locator('.markdown-content pre').last();
  await expect(code).toContainText('Hello from ESP32');
  await expect(code).toHaveCSS('background-color', 'rgb(250, 250, 250)');
  await expect(code.locator('code')).toHaveCSS('color', 'rgb(32, 32, 32)');
  await page
    .locator('.ai-panel')
    .screenshot({ path: '.tmp/ai-light-code.png', animations: 'disabled' });
});
