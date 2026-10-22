import { expect, test } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

test('admin chat uses central models even when reopening a legacy tier conversation', async ({
  page,
}) => {
  await installAuthenticatedSession(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'iot-hub.admin.ai-conversations.v2',
      JSON.stringify([
        {
          id: 'legacy-chat',
          title: 'Previous investigation',
          model: 'old/model',
          profile: 'deep',
          createdAt: '2026-10-11T00:00:00Z',
          updatedAt: '2026-10-11T00:00:00Z',
          messages: [
            {
              id: 'previous',
              role: 'user',
              content: 'Previous question',
              createdAt: '2026-10-11T00:00:00Z',
            },
          ],
        },
      ]),
    );
  });
  const requests: unknown[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ json: body });
    if (url.hostname.endsWith('.supabase.co')) return json({});
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/auth/me')
      return json({
        id: '55555555-5555-4555-8555-555555555555',
        username: 'admin',
        email: 'admin@example.com',
        isActive: true,
        role: { name: 'admin' },
      });
    if (url.pathname === '/api/auth/me/avatar') return route.fulfill({ status: 404 });
    if (url.pathname === '/api/admin/ai/catalog')
      return json({
        configured: true,
        stale: false,
        fetchedAt: '2026-10-11T00:00:00Z',
        allowPaidModels: false,
        profiles: [],
        vendors: [],
      });
    if (url.pathname === '/api/admin/ai/chat') {
      requests.push(route.request().postDataJSON());
      return json({
        id: 'reply',
        model: 'central/model',
        vendor: 'central',
        profile: 'auto',
        autoSelected: true,
        content: 'Shared model reply',
        createdAt: '2026-10-11T00:01:00Z',
      });
    }
    return json([]);
  });

  await page.goto('/admin/ai-assistant');
  await expect(page.getByText('ใช้โมเดลเดียวกับ IDE')).toBeVisible();
  await expect(page.getByRole('listbox', { name: 'เลือกระดับโมเดล AI' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /X[123]/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'เปิดประวัติแชท' }).click();
  await page.getByRole('button', { name: /^Previous investigation/ }).click();
  await expect(page.getByText('Previous question', { exact: true })).toBeVisible();
  await page.getByLabel('พิมพ์คำถามถึง AI').fill('Continue investigating');
  await page.getByRole('button', { name: 'ส่งข้อความ' }).click();
  await expect(page.getByText('Shared model reply')).toBeVisible();
  await expect(page.getByText('central/model', { exact: true })).toBeVisible();
  expect(requests).toEqual([
    {
      messages: [
        { role: 'user', content: 'Previous question' },
        { role: 'user', content: 'Continue investigating' },
      ],
      includeSystemContext: true,
    },
  ]);
});
