import { expect, test } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

for (const scenario of [
  {
    name: 'Google OAuth',
    provider: 'google',
    providers: ['google'],
    methods: ['oauth'],
    allowed: false,
  },
  {
    name: 'GitHub OAuth',
    provider: 'github',
    providers: ['github'],
    methods: ['oauth'],
    allowed: false,
  },
  {
    name: 'linked email account using OAuth',
    provider: 'email',
    providers: ['email', 'google'],
    methods: ['oauth'],
    allowed: false,
  },
  {
    name: 'linked Google account using password',
    provider: 'google',
    providers: ['google', 'email'],
    methods: ['password', 'totp'],
    allowed: true,
  },
  {
    name: 'unknown session method',
    provider: 'email',
    providers: ['email'],
    methods: [],
    allowed: false,
  },
]) {
  test(`${scenario.name} credential settings`, async ({ page }) => {
    await installAuthenticatedSession(page, scenario);
    let credentialWrites = 0;
    await page.route('**/*.supabase.co/**', (route) => {
      if (route.request().method() !== 'GET') credentialWrites++;
      return route.fulfill({ json: {} });
    });
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/me')
        return route.fulfill({
          json: {
            id: '55555555-5555-4555-8555-555555555555',
            username: 'maker',
            email: 'e2e@example.com',
            isActive: true,
            role: { name: 'user' },
          },
        });
      if (path === '/api/auth/me/avatar') return route.fulfill({ status: 404 });
      return route.fulfill({ json: [] });
    });
    await page.goto('/user/settings');
    await page.getByRole('button', { name: 'อีเมลและรหัสผ่าน', exact: true }).click();
    if (scenario.allowed) {
      await expect(page.getByLabel('อีเมลใหม่', { exact: true })).toBeVisible();
      await expect(page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true })).toBeVisible();
    } else {
      await expect(
        page.getByText('คุณยังเปลี่ยนชื่อผู้ใช้งานและรูปโปรไฟล์ใน IoT Hub ได้ตามปกติ'),
      ).toBeVisible();
      if (scenario.methods.includes('oauth')) {
        await expect(
          page.getByText(/กรุณาจัดการข้อมูลที่ Google หรือ GitHub โดยตรง/),
        ).toBeVisible();
      }
      await expect(page.getByLabel('อีเมลใหม่', { exact: true })).toHaveCount(0);
      await expect(page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'ยืนยันเปลี่ยนอีเมล' })).toHaveCount(0);
      await page.reload();
      await page.getByRole('button', { name: 'อีเมลและรหัสผ่าน', exact: true }).click();
      await expect(page.getByLabel('อีเมลใหม่', { exact: true })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'โปรไฟล์', exact: true }).click();
    await expect(page.getByLabel('ชื่อผู้ใช้งาน', { exact: true })).toBeEditable();
    await expect(page.getByRole('button', { name: 'เปลี่ยนรูปโปรไฟล์' })).toBeEnabled();
    expect(credentialWrites).toBe(0);
  });
}
