import { expect, test, type Page } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

const cacheKey = 'iot-hub:account-display';
const user = {
  id: '55555555-5555-4555-8555-555555555555',
  username: 'maker',
  email: 'e2e@example.com',
  isActive: true,
  role: { name: 'user' },
};

function gate() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

async function mockPublicPage(page: Page) {
  await page.route('**/*.supabase.co/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/community/**', (route) =>
    route.fulfill({ json: { data: [], meta: { nextCursor: null } } }),
  );
}

test('cold profile load shows skeletons; refresh retains the confirmed account name', async ({
  page,
}) => {
  await installAuthenticatedSession(page);
  await mockPublicPage(page);
  let pending = gate();
  let username = user.username;
  await page.route('**/api/auth/me', async (route) => {
    await pending.ready;
    await route.fulfill({ json: { ...user, username } });
  });
  await page.goto('/community');
  await expect(page.locator('.account-skeleton')).toBeVisible();
  await expect(page.locator('.identity-skeleton')).toBeVisible();
  await expect(page.locator('.site-header a[href="/auth/login"]')).toHaveCount(0);
  await expect(page.locator('.create-bar app-author-badge')).toHaveCount(0);
  pending.release();
  await expect(page.locator('.user-account-link')).toHaveText('MA');
  await expect(page.locator('.create-bar app-author-badge')).toContainText('maker');

  pending = gate();
  await page.reload();
  // The profile request is still held, so these assertions exercise the display cache.
  await expect(page.locator('.user-account-link')).toHaveText('MA');
  await expect(page.locator('.create-bar app-author-badge')).toContainText('maker');
  await page.locator('.user-account-link').click();
  await expect(page.locator('.account-summary strong')).toHaveText('maker');
  username = 'renamed-maker';
  pending.release();
  await expect(page.locator('.account-summary strong')).toHaveText(username);
  expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), cacheKey)).toEqual({
    userId: user.id,
    username,
  });
});

for (const cache of [
  JSON.stringify({ userId: 'another-account', username: 'wrong-user', role: 'admin' }),
  '{broken',
]) {
  test(`invalid or foreign cache is never used: ${cache.slice(0, 15)}`, async ({ page }) => {
    await installAuthenticatedSession(page);
    await mockPublicPage(page);
    await page.addInitScript(({ key, value }) => sessionStorage.setItem(key, value), {
      key: cacheKey,
      value: cache,
    });
    const pending = gate();
    await page.route('**/api/auth/me', async (route) => {
      await pending.ready;
      await route.fulfill({ json: user });
    });
    await page.goto('/community');
    await expect(page.locator('.account-skeleton')).toBeVisible();
    await expect(page.getByText('wrong-user', { exact: true })).toHaveCount(0);
    pending.release();
    await expect(page.locator('.user-account-link')).toHaveText('MA');
  });
}

test('logout clears cached identity and a late profile response cannot restore it', async ({
  page,
}) => {
  await installAuthenticatedSession(page);
  await mockPublicPage(page);
  await page.addInitScript(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), {
    key: cacheKey,
    value: { userId: user.id, username: user.username },
  });
  const pending = gate();
  await page.route('**/api/auth/me', async (route) => {
    await pending.ready;
    await route.fulfill({ json: user });
  });
  await page.goto('/community');
  await page.locator('.user-account-link').click();
  await page.locator('.account-item-danger').click();
  await expect(page.locator('.site-header a[href="/auth/login"]')).toBeVisible();
  const response = page.waitForResponse('**/api/auth/me');
  pending.release();
  await response;
  await expect(page.locator('.user-account-link')).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), cacheKey)).toBeNull();
});

test('profile failure ends the skeleton without showing a guest identity', async ({ page }) => {
  await installAuthenticatedSession(page);
  await mockPublicPage(page);
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 503, json: { error: { message: 'Temporarily unavailable' } } }),
  );
  await page.goto('/community');
  await expect(page.locator('.user-account-link')).toBeVisible();
  await expect(page.locator('.account-skeleton')).toHaveCount(0);
  await expect(page.locator('.site-header a[href="/auth/login"]')).toHaveCount(0);
  await page.locator('.user-account-link').click();
  await expect(page.locator('.account-summary strong')).toHaveText('บัญชีของคุณ');
});

test('blocked display storage does not prevent the profile from loading', async ({ page }) => {
  await installAuthenticatedSession(page);
  await mockPublicPage(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get: () => {
        throw new Error('Storage blocked');
      },
    });
  });
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: user }));
  await page.goto('/community');
  await expect(page.locator('.user-account-link')).toHaveText('MA');
});

test('saved display name stays visible during profile refresh without replacing the username', async ({
  page,
}) => {
  await installAuthenticatedSession(page);
  await mockPublicPage(page);
  let pending = gate();
  pending.release();
  await page.route('**/api/auth/me', async (route) => {
    await pending.ready;
    await route.fulfill({ json: { ...user, displayName: 'นักประดิษฐ์' } });
  });
  await page.goto('/community');
  await page.locator('.user-account-link').click();
  await expect(page.locator('.account-summary strong')).toHaveText('นักประดิษฐ์');
  pending = gate();
  await page.reload();
  await page.locator('.user-account-link').click();
  await expect(page.locator('.account-summary strong')).toHaveText('นักประดิษฐ์');
  await expect(page.locator('.create-bar app-author-badge')).toContainText('maker');
  pending.release();
});
