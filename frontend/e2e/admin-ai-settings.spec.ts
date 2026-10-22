import { expect, test, type Page } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

const adminId = '55555555-5555-4555-8555-555555555555';
const studentId = '77777777-7777-4777-8777-777777777777';

interface Server {
  puts: unknown[];
  overridePuts: { path: string; body: unknown }[];
  settings: Record<string, unknown>;
}

function model(id: string, isFree: boolean) {
  return {
    id,
    name: id,
    vendor: id.split('/')[0],
    isFree,
    supportsTools: true,
    contextLength: 128000,
    promptPricePerMillion: isFree ? 0 : 0.5,
    completionPricePerMillion: isFree ? 0 : 1.5,
  };
}

async function prepare(page: Page, latencyAvailable = true): Promise<Server> {
  const server: Server = {
    puts: [],
    overridePuts: [],
    settings: {
      primaryModel: null,
      fallbackModels: [],
      defaults: { daily: -1, weekly: -1, monthly: -1 },
      resets: { dailyMinute: 0, weeklyMinute: 0, weeklyDay: 0, monthlyMinute: 0, monthlyDay: 1 },
      updatedAt: '2026-10-11T00:00:00Z',
    },
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
        id: adminId,
        username: 'admin',
        email: 'admin@example.com',
        isActive: true,
        role: { name: 'admin' },
      });
    if (path === '/api/auth/me/avatar') return json({}, 404);
    if (path === '/api/admin/ai-settings' && method === 'GET')
      return json({
        ...server.settings,
        catalog: {
          stale: false,
          fetchedAt: '2026-10-11T00:00:00Z',
          latencyOrder: latencyAvailable
            ? ['openai/gpt-mini', 'google/gemini-flash:free', 'meta/llama-70b:free']
            : [],
          models: [
            model('google/gemini-flash:free', true),
            model('meta/llama-70b:free', true),
            model('openai/gpt-mini', false),
          ],
        },
      });
    if (path === '/api/admin/ai-settings' && method === 'PUT') {
      const body = request.postDataJSON() as Record<string, unknown>;
      server.puts.push(body);
      server.settings = { ...server.settings, ...body };
      return json(server.settings);
    }
    if (path === '/api/admin/ai-settings/usage')
      return json({
        totals: { daily: 4, weekly: 12, monthly: 40 },
        topUsers: [{ userId: studentId, username: 'student', credits: 30 }],
      });
    if (path === '/api/admin/ai-settings/overrides') return json([]);
    if (path.startsWith('/api/admin/ai-settings/overrides/') && method === 'PUT') {
      server.overridePuts.push({ path, body: request.postDataJSON() });
      return json({});
    }
    if (path === '/api/admin/users')
      return json([
        {
          id: studentId,
          username: 'student',
          email: 'student@example.com',
          role: { id: 'r', name: 'user' },
          status: 'active',
          createdAt: '2026-10-01T00:00:00Z',
          lastLoginAt: null,
          lastLoginIp: null,
          lastLoginAvailable: false,
        },
      ]);
    return json([]);
  });
  return server;
}

test('admin content scrolls without adding an outer document scrollbar', async ({ page }) => {
  await prepare(page);
  const serviceRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/admin/integrations')
      serviceRequests.push(request.url());
  });
  await page.goto('/admin/integrations');
  await expect(page.getByRole('combobox', { name: 'โมเดลหลัก', exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerHeight,
    document: document.documentElement.scrollHeight,
    elements: ['app-root', 'app-admin-shell', 'main', 'app-integrations-page'].map((selector) => {
      const element = document.querySelector(selector)!;
      const style = getComputedStyle(element);
      return {
        selector,
        height: element.getBoundingClientRect().height,
        scroll: element.scrollHeight,
        display: style.display,
        overflow: style.overflow,
      };
    }),
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
  const main = page.getByRole('main');
  await main.hover();
  await page.mouse.wheel(0, 1000);
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(serviceRequests).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
    .toBeLessThanOrEqual(844);
});

test('section skeletons stay visible until their data arrives', async ({ page }) => {
  await prepare(page);
  const hold = () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { pending, release };
  };
  const settings = hold();
  const usage = hold();
  const users = hold();
  for (const [path, gate] of [
    ['ai-settings', settings],
    ['ai-settings/usage', usage],
    ['users', users],
  ] as const) {
    await page.route(`**/api/admin/${path}`, async (route) => {
      await gate.pending;
      await route.fallback();
    });
  }
  try {
    await page.goto('/admin/integrations');
    await expect(
      page.getByRole('status').filter({ hasText: 'กำลังโหลดการตั้งค่า AI' }),
    ).toBeAttached();
    await expect(page.locator('app-integrations-skeleton')).toHaveCount(1);
    await expect(page.getByRole('combobox', { name: 'โมเดลหลัก', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(720);
    await page.screenshot({ path: 'test-results/admin-integrations-loading.png' });
    settings.release();
    await expect(page.getByRole('combobox', { name: 'โมเดลหลัก', exact: true })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'กำลังโหลดการใช้งาน credit' }),
    ).toBeAttached();
    await expect(page.getByRole('status').filter({ hasText: 'กำลังโหลดผู้ใช้' })).toBeAttached();
    await expect(page.getByRole('combobox', { name: 'ผู้ใช้', exact: true })).toHaveCount(0);
    usage.release();
    users.release();
    await expect(page.locator('app-integrations-skeleton')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'ผู้ใช้', exact: true })).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Credit AI ต่อคน' })).toContainText('40 credit');
  } finally {
    for (const gate of [settings, usage, users]) gate.release();
  }
});

test('failed settings loads replace the skeleton with a retry action', async ({ page }) => {
  await prepare(page);
  let attempts = 0;
  await page.route('**/api/admin/ai-settings', async (route) => {
    if (++attempts === 1) return route.fulfill({ status: 503, json: { message: 'โหลดไม่สำเร็จ' } });
    return route.fallback();
  });
  await page.goto('/admin/integrations');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('โหลดการตั้งค่า AI ไม่สำเร็จ');
  await expect(page.locator('app-integrations-skeleton')).toHaveCount(0);
  await alert.getByRole('button', { name: 'ลองอีกครั้ง' }).click();
  await expect(page.getByRole('combobox', { name: 'โมเดลหลัก', exact: true })).toBeVisible();
  await expect(alert).toHaveCount(0);
});

test('an admin picks the primary and fallback models, sets credit limits, and overrides one user', async ({
  page,
}) => {
  const server = await prepare(page);
  await page.goto('/admin/integrations');
  await expect(page.getByRole('heading', { name: 'จัดการ AI', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'จัดการ AI', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('จัดการ AI — IoT Hub Admin');
  await expect(page.getByRole('heading', { name: 'สถานะบริการ' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ตรวจสอบอีกครั้ง' })).toHaveCount(0);

  const models = page.getByRole('region', { name: 'โมเดล AI หลักและสำรอง' });
  await models.getByRole('combobox', { name: 'กรองราคา' }).click();
  await models.getByRole('option', { name: 'เฉพาะโมเดลฟรี' }).click();
  await models.getByRole('combobox', { name: 'โมเดลหลัก', exact: true }).click();
  await expect(models.getByRole('option')).toHaveCount(3);
  await models.getByRole('option', { name: /google\/gemini/ }).click();
  await models.getByRole('combobox', { name: 'เลือกโมเดลสำรองที่จะเพิ่ม' }).fill('llama');
  await models.getByRole('option', { name: /meta\/llama/ }).click();
  await models.getByRole('button', { name: 'เพิ่มเป็นสำรอง' }).click();
  await models.getByRole('button', { name: 'บันทึกโมเดล' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'บันทึกแล้ว:' })).toContainText(
    'google/gemini-flash:free',
  );
  expect(server.puts[0]).toEqual({
    primaryModel: 'google/gemini-flash:free',
    fallbackModels: ['meta/llama-70b:free'],
  });

  const credits = page.getByRole('region', { name: 'Credit AI ต่อคน' });
  await expect(credits).toContainText('40 credit');
  await expect(credits).toContainText('student');
  const daily = credits.getByRole('group', { name: 'ต่อวัน' }).first();
  await expect(daily.getByLabel('credit ต่อวัน')).toBeVisible();
  await expect(daily.getByLabel('credit ต่อวัน')).toBeDisabled();
  await daily.getByLabel('จำกัด', { exact: true }).check();
  await daily.getByLabel('credit ต่อวัน').fill('20');
  await credits.getByRole('button', { name: 'บันทึก limit ค่าเริ่มต้น' }).click();
  await expect.poll(() => server.puts.length).toBe(2);
  expect(server.puts[1]).toEqual({ defaults: { daily: 20, weekly: -1, monthly: -1 } });
  // Results appear as a toast pinned to the top right of the viewport.
  const toast = page.getByRole('status').filter({ hasText: 'บันทึก limit ค่าเริ่มต้นแล้ว' });
  await expect(toast).toBeVisible();
  const box = (await toast.boundingBox())!;
  // Stacked under the model toast, which is still counting down.
  expect(box.y).toBeLessThan(160);
  expect(box.x + box.width).toBeGreaterThan(page.viewportSize()!.width - 40);
  await toast.getByRole('button', { name: 'ปิดการแจ้งเตือน' }).click();
  await expect(toast).toHaveCount(0);

  const picker = credits.getByRole('combobox', { name: 'ผู้ใช้', exact: true });
  await picker.scrollIntoViewIfNeeded();
  await picker.fill('student@');
  await credits.getByRole('option', { name: /student@example.com/ }).click();
  const overrideMonthly = credits.getByRole('group', { name: 'ต่อเดือน' }).nth(1);
  await overrideMonthly.getByLabel('ไม่จำกัด').check();
  await credits.getByLabel('หมายเหตุ (ไม่บังคับ)').fill('ผู้สอน');
  await credits.getByRole('button', { name: 'บันทึก limit ของผู้ใช้นี้' }).click();
  await expect.poll(() => server.overridePuts.length).toBe(1);
  expect(server.overridePuts[0]).toEqual({
    path: `/api/admin/ai-settings/overrides/${studentId}`,
    body: { daily: null, weekly: null, monthly: -1, note: 'ผู้สอน' },
  });
  await page.screenshot({ path: 'test-results/admin-integrations-desktop.png', fullPage: true });
});

test('search, price filters, and latency ordering keep the current model selected', async ({
  page,
}) => {
  await prepare(page);
  await page.goto('/admin/integrations');
  const models = page.getByRole('region', { name: 'โมเดล AI หลักและสำรอง' });
  const primary = models.getByRole('combobox', { name: 'โมเดลหลัก', exact: true });
  await primary.fill('gpt');
  await expect(models.getByRole('option')).toHaveCount(1);
  await primary.press('Enter');
  await expect(primary).toHaveValue('openai/gpt-mini');
  await models.getByRole('combobox', { name: 'กรองราคา' }).click();
  await models.getByRole('option', { name: 'เฉพาะโมเดลฟรี' }).click();
  await expect(primary).toHaveValue('openai/gpt-mini');
  await primary.click();
  await expect(models.getByRole('option', { name: /openai/ })).toHaveCount(0);
  await primary.fill('no such model');
  await expect(models.getByText('ไม่พบตัวเลือกที่ตรงกัน')).toBeVisible();
  await primary.press('Escape');
  await expect(primary).toHaveValue('openai/gpt-mini');

  await models.getByRole('combobox', { name: 'กรองราคา' }).click();
  await models.getByRole('option', { name: 'ทุกราคา', exact: true }).click();
  for (const [label, first] of [
    ['ราคา: มากไปน้อย', 'openai/gpt-mini'],
    ['ราคา: น้อยไปมาก', 'google/gemini-flash:free'],
    ['Latency: น้อยไปมาก', 'openai/gpt-mini'],
    ['Latency: มากไปน้อย', 'meta/llama-70b:free'],
  ]) {
    await models.getByRole('combobox', { name: 'เรียงลำดับโมเดล' }).click();
    await models.getByRole('option', { name: label, exact: true }).click();
    await primary.click();
    await expect(models.getByRole('option').nth(1)).toContainText(first);
    await primary.press('Escape');
  }
});

test('credit controls preserve limits when toggled and refuse invalid values', async ({ page }) => {
  const server = await prepare(page);
  await page.goto('/admin/integrations');
  const credits = page.getByRole('region', { name: 'Credit AI ต่อคน' });
  const daily = credits.getByRole('group', { name: 'ต่อวัน' }).first();
  const amount = daily.getByLabel('credit ต่อวัน');
  await daily.getByLabel('จำกัด', { exact: true }).check();
  await amount.fill('24');
  await daily.getByLabel('ไม่จำกัด', { exact: true }).check();
  await expect(amount).toBeVisible();
  await expect(amount).toBeDisabled();
  await expect(amount).toHaveValue('24');
  await credits.getByRole('button', { name: 'บันทึก limit ค่าเริ่มต้น' }).click();
  await expect.poll(() => server.puts.length).toBe(1);
  expect(server.puts[0]).toEqual({ defaults: { daily: -1, weekly: -1, monthly: -1 } });
  await daily.getByLabel('จำกัด', { exact: true }).check();
  await amount.fill('1000001');
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(credits.getByRole('button', { name: 'บันทึก limit ค่าเริ่มต้น' })).toBeDisabled();
  await expect(amount).toHaveCSS('appearance', 'textfield');
});

test('a failed save shows an error toast that closes on its own', async ({ page }) => {
  await prepare(page);
  await page.clock.install();
  await page.route('**/api/admin/ai-settings', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({
          status: 400,
          json: { error: { code: 'VALIDATION_FAILED', message: 'ค่า limit ไม่ถูกต้อง' } },
        })
      : route.fallback(),
  );
  await page.goto('/admin/integrations');
  const credits = page.getByRole('region', { name: 'Credit AI ต่อคน' });
  await credits.getByRole('button', { name: 'บันทึก limit ค่าเริ่มต้น' }).click();
  const toast = page.getByRole('alert').filter({ hasText: 'ค่า limit ไม่ถูกต้อง' });
  await expect(toast).toBeVisible();
  await page.clock.runFor(6000);
  await expect(toast).toHaveCount(0);
});

test('integrations layout fits mobile and searchable menus stay in the viewport', async ({
  page,
}) => {
  await prepare(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/integrations');
  const primary = page.getByRole('combobox', { name: 'โมเดลหลัก', exact: true });
  await primary.fill('gemini');
  await expect(page.getByRole('option', { name: /google\/gemini/ })).toBeVisible();
  const menu = await page.getByRole('listbox').boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(0);
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(390);
  await primary.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/admin-integrations-mobile.png', fullPage: true });
});

test('missing latency data disables only latency ordering and keyboard search remains usable', async ({
  page,
}) => {
  await prepare(page, false);
  await page.goto('/admin/integrations');
  const models = page.getByRole('region', { name: 'โมเดล AI หลักและสำรอง' });
  await expect(models.getByText('ยังไม่มีข้อมูลจัดอันดับ latency')).toBeVisible();
  const sort = models.getByRole('combobox', { name: 'เรียงลำดับโมเดล' });
  await sort.click();
  await expect(models.getByRole('option', { name: 'Latency: น้อยไปมาก' })).toBeDisabled();
  await expect(models.getByRole('option', { name: 'Latency: มากไปน้อย' })).toBeDisabled();
  await sort.press('Escape');
  const primary = models.getByRole('combobox', { name: 'โมเดลหลัก', exact: true });
  await primary.focus();
  await primary.press('ArrowDown');
  await primary.press('ArrowDown');
  await primary.press('Enter');
  await expect(primary).toHaveValue('google/gemini-flash:free');
  await primary.fill('google/gemini-flash:free');
  await primary.press(' ');
  await expect(primary).toHaveAttribute('aria-expanded', 'true');
  await primary.press('Tab');
  await expect(primary).toHaveAttribute('aria-expanded', 'false');
});

test('an admin saves Bangkok reset schedules and sees them after reloading', async ({ page }) => {
  const server = await prepare(page);
  await page.goto('/admin/integrations');
  const reset = page.getByRole('form', { name: 'รอบรีเซ็ตโควตา' });
  await expect(reset.getByLabel('เวลารีเซ็ตรายวัน', { exact: true })).toHaveValue('00:00');
  await reset.getByLabel('เวลารีเซ็ตรายวัน', { exact: true }).fill('08:30');
  await reset.getByRole('combobox', { name: 'วันรีเซ็ตรายสัปดาห์', exact: true }).click();
  await reset.getByRole('option', { name: 'วันศุกร์', exact: true }).click();
  await reset.getByLabel('เวลารีเซ็ตรายสัปดาห์', { exact: true }).fill('18:15');
  await reset.getByRole('combobox', { name: 'วันที่รีเซ็ตรายเดือน', exact: true }).click();
  await reset.getByRole('option', { name: 'วันที่ 15', exact: true }).click();
  await reset.getByLabel('เวลารีเซ็ตรายเดือน', { exact: true }).fill('09:00');
  await reset.getByRole('button', { name: 'บันทึกรอบรีเซ็ต' }).click();
  await expect.poll(() => server.puts.length).toBe(1);
  expect(server.puts[0]).toEqual({
    resets: {
      dailyMinute: 510,
      weeklyMinute: 1095,
      weeklyDay: 4,
      monthlyMinute: 540,
      monthlyDay: 15,
    },
  });
  await page.reload();
  await expect(reset.getByLabel('เวลารีเซ็ตรายวัน', { exact: true })).toHaveValue('08:30');
  await expect(
    reset.getByRole('combobox', { name: 'วันรีเซ็ตรายสัปดาห์', exact: true }),
  ).toContainText('วันศุกร์');
  await expect(
    reset.getByRole('combobox', { name: 'วันที่รีเซ็ตรายเดือน', exact: true }),
  ).toContainText('วันที่ 15');
  await expect(reset.getByRole('button', { name: 'บันทึกรอบรีเซ็ต' })).toBeDisabled();
  await reset.getByLabel('เวลารีเซ็ตรายวัน', { exact: true }).fill('');
  await expect(reset.getByRole('button', { name: 'บันทึกรอบรีเซ็ต' })).toBeDisabled();
});
