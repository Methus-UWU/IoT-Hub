import { expect, test } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`advisor sends error logs and follow-ups from the chat composer at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installAuthenticatedSession(page);
    await page.route('**/*.supabase.co/**', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/**', (route) => {
      if (new URL(route.request().url()).pathname === '/api/auth/me') {
        return route.fulfill({
          json: {
            id: '55555555-5555-4555-8555-555555555555',
            username: 'maker',
            email: 'e2e@example.com',
            isActive: true,
            role: { name: 'user' },
          },
        });
      }
      return route.fulfill({ json: [] });
    });
    const requests: { mode: string; messages: { role: string; content: string }[] }[] = [];
    await page.route('**/api/ai/advisor/chat', async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          id: 'reply',
          content: 'Declare **ledPin** before using it.',
          model: 'fixture',
          createdAt: '2026-10-06T00:00:00Z',
        },
      });
    });
    const projectId = '11111111-1111-4111-8111-111111111111';
    await page.goto(
      viewport.width > 640 ? `/user/projects/${projectId}/assistant` : '/user/assistant',
    );
    await page.getByRole('button', { name: 'วิเคราะห์ Error', exact: true }).click();
    const draft = page.getByRole('textbox', { name: 'ข้อความถึงผู้ช่วย' });
    const send = page.getByRole('button', { name: 'ส่งข้อความ', exact: true });
    await expect(draft).toBeInViewport();
    await expect(send).toBeDisabled();
    const log = "Arduino IDE\nerror: 'ledPin' was not declared in this scope";
    await draft.fill(log);
    await draft.press('Enter');
    await expect(page.locator('.markdown-content strong')).toHaveText('ledPin');
    expect(requests[0]).toEqual({ mode: 'error', messages: [{ role: 'user', content: log }] });
    await expect(page.locator('.user-text')).toHaveText(log);
    await draft.fill('Where should I declare it?');
    await send.click();
    await expect(page.locator('.markdown-content')).toHaveCount(2);
    expect(requests[1].messages).toHaveLength(3);
    await expect(draft).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `test-results/advisor-${viewport.width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'เริ่มบทสนทนาใหม่' }).click();
    await expect(page.locator('.message')).toHaveCount(0);
    await expect(draft).toBeInViewport();
    await page.getByRole('button', { name: 'ถามผู้ช่วย', exact: true }).click();
    await draft.fill('How do I connect a DHT22?');
    await draft.press('Shift+Enter');
    expect(requests).toHaveLength(2);
    await draft.press('Enter');
    await expect(page.locator('.markdown-content')).toHaveCount(1);
    expect(requests[2].mode).toBe('advice');

    await page.route('**/api/ai/advisor/chat', (route) => route.fulfill({ status: 503, json: {} }));
    await draft.fill('Try again');
    await send.click();
    await expect(page.locator('.thread-error')).toBeVisible();
    await draft.fill('Retry');
    await expect(send).toBeEnabled();
  });
}
