import { expect, test, type Page } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

const user = {
  id: '55555555-5555-4555-8555-555555555555',
  username: 'maker',
  email: 'e2e@example.com',
  isActive: true,
  role: { name: 'user' },
};

async function portraitPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 20;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#315577';
    context.fillRect(0, 0, 40, 20);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(base64, 'base64');
}

async function prepare(page: Page) {
  await installAuthenticatedSession(page);
  await page.route('**/*.supabase.co/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: user });
    if (path === '/api/auth/me/avatar')
      return route.fulfill({ status: 404, json: { code: 'AVATAR_NOT_FOUND' } });
    if (path.startsWith('/api/community/'))
      return route.fulfill({ json: { data: [], meta: { nextCursor: null } } });
    return route.fulfill({ json: [] });
  });
}

test.beforeEach(async ({ page }) => prepare(page));

test('only the account trigger highlights; its dropdown opens settings and dismisses', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/user/projects');
  const card = page.locator('.account-card');
  const trigger = page.getByLabel('เมนูบัญชี', { exact: true });
  const background = await card.evaluate((element) => getComputedStyle(element).backgroundColor);
  await card.locator('.account-copy').hover();
  expect(await card.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    background,
  );
  await trigger.hover();
  await expect(trigger).toHaveCSS('background-color', 'rgb(243, 243, 243)');
  expect(await card.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    background,
  );
  await trigger.click();
  const settings = page.getByRole('link', { name: 'ตั้งค่า', exact: true });
  await expect(settings).toBeVisible();
  await expect(page.getByRole('button', { name: 'ออกจากระบบ', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(settings).toBeVisible();
  await page.locator('.account-copy').click();
  await expect(settings).toBeHidden();
  await trigger.click();
  await settings.click();
  await expect(page).toHaveURL(/\/user\/settings$/);
  await expect(page.getByRole('heading', { name: 'ตั้งค่าบัญชี', exact: true })).toBeVisible();
  await expect(page.getByLabel('ชื่อผู้ใช้งาน', { exact: true })).toHaveValue(user.username);
  await page.screenshot({ path: '.tmp/account-settings-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'ชุมชน', exact: true }).click();
  await expect(page).toHaveURL(/\/community$/);
});

test('mobile drawer closes when opening settings and forms fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/user/projects');
  await page.getByRole('button', { name: 'เปิดหรือปิดเมนู' }).click();
  await page.getByLabel('เมนูบัญชี', { exact: true }).click();
  await page.getByRole('link', { name: 'ตั้งค่า', exact: true }).click();
  await expect(page.locator('.workspace-sidebar')).not.toHaveClass(/sidebar-mobile-open/);
  await expect(page.getByRole('heading', { name: 'ตั้งค่าบัญชี', exact: true })).toBeVisible();
  await expect(page.getByLabel('ชื่อผู้ใช้งาน', { exact: true })).toHaveValue(user.username);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/account-settings-mobile.png', fullPage: true });
});

for (const reload of [false, true]) {
  test(`settings returns to its originating page and query, reload=${reload}`, async ({ page }) => {
    await page.goto('/user/projects?view=all');
    await page.getByLabel('เมนูบัญชี', { exact: true }).click();
    await page.getByRole('link', { name: 'ตั้งค่า', exact: true }).click();
    await expect(page.getByLabel('ชื่อผู้ใช้งาน', { exact: true })).toHaveValue(user.username);
    if (reload) {
      await page.reload();
      await expect(page.getByLabel('ชื่อผู้ใช้งาน', { exact: true })).toHaveValue(user.username);
    }
    await page.getByRole('button', { name: 'อีเมลและรหัสผ่าน', exact: true }).click();
    await page.getByRole('button', { name: 'ย้อนกลับ', exact: true }).click();
    await expect(page).toHaveURL(/\/user\/projects\?view=all$/);
  });
}

test('direct settings entry has a safe back fallback and neutral focus/selected states', async ({
  page,
}) => {
  await page.goto('/user/settings');
  const name = page.getByLabel('ชื่อที่แสดง', { exact: true });
  await name.focus();
  await expect(name).toHaveCSS('outline-style', 'none');
  await expect(name).toHaveCSS('border-color', 'rgb(104, 104, 104)');
  await expect(page.getByLabel('แนะนำตัว', { exact: true })).toHaveCSS('resize', 'none');
  await expect(page.getByRole('button', { name: 'โปรไฟล์', exact: true })).toHaveCSS(
    'background-color',
    'rgb(237, 237, 237)',
  );
  await page.getByRole('button', { name: 'ย้อนกลับ', exact: true }).click();
  await expect(page).toHaveURL(/\/user\/projects$/);
});

test('profile stays entirely behind skeleton until its avatar is ready', async ({ page }) => {
  const png = await portraitPng(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/auth/me/avatar', async (route) => {
    await pending;
    return route.fulfill({ contentType: 'image/png', body: png });
  });
  await page.goto('/user/settings');
  const skeleton = page.locator('app-profile-page app-settings-skeleton');
  await expect(skeleton).toBeVisible();
  await expect(page.locator('app-avatar-editor')).toHaveCount(0);
  await expect(page.getByLabel('ชื่อผู้ใช้งาน', { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByLabel('ชื่อผู้ใช้งาน', { exact: true })).toHaveValue(user.username);
  await expect(page.locator('app-avatar-editor img')).toBeVisible();
  await expect(skeleton).toHaveCount(0);
  expect(
    await page
      .locator('app-avatar-editor img')
      .evaluate((element) => (element as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
});

test('failed avatar loading ends the skeleton and keeps profile editing available', async ({
  page,
}) => {
  await page.route('**/api/auth/me/avatar', (route) => route.fulfill({ status: 503 }));
  await page.goto('/user/settings');
  await expect(page.getByLabel('ชื่อผู้ใช้งาน', { exact: true })).toHaveValue(user.username);
  await expect(page.getByText('โหลดรูปเดิมไม่ได้ คุณยังเลือกรูปใหม่ได้')).toBeVisible();
  await expect(page.locator('app-profile-page app-settings-skeleton')).toHaveCount(0);
});

test('unavailable profile shows a stable skeleton, then an inline error and working retry', async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  let recovered = false;
  await page.route('**/api/auth/me', async (route) => {
    requests++;
    if (requests > 4) await pending;
    return recovered ? route.fulfill({ json: user }) : route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/user/settings');
  const skeleton = page.locator('app-profile-page > .settings-page app-settings-skeleton').first();
  await expect(skeleton).toBeVisible({ timeout: 15000 });
  expect(
    await skeleton.evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await expect(page.getByLabel('ชื่อผู้ใช้งาน', { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: 'โหลดข้อมูลบัญชีไม่สำเร็จ' })).toBeVisible();
  recovered = true;
  await page.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
  await expect(page.getByLabel('ชื่อผู้ใช้งาน', { exact: true })).toHaveValue(user.username);
});

test('profile validation, failed save, and successful save update sidebar identity', async ({
  page,
}) => {
  await page.goto('/user/settings');
  let rejected = true;
  await page.route('**/api/auth/me', (route) => {
    if (route.request().method() !== 'PATCH') return route.fulfill({ json: user });
    expect(route.request().postDataJSON()).toEqual({
      username: 'new-maker',
      displayName: '',
      bio: '',
    });
    return rejected
      ? route.fulfill({ status: 409, json: { message: 'Already taken' } })
      : route.fulfill({ json: { ...user, username: 'new-maker' } });
  });
  const save = page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' });
  await page.getByLabel('ชื่อผู้ใช้งาน', { exact: true }).fill('a');
  await expect(save).toBeDisabled();
  await page.getByLabel('ชื่อผู้ใช้งาน', { exact: true }).fill('new-maker');
  await save.click();
  await expect(
    page.getByText('ไม่สามารถบันทึกโปรไฟล์ได้ ชื่อผู้ใช้งานอาจถูกใช้งานแล้ว กรุณาลองอีกครั้ง'),
  ).toBeVisible();
  await expect(page.locator('.account-copy strong')).toHaveText('maker');
  rejected = false;
  await save.click();
  await expect(page.locator('.account-copy strong')).toHaveText('new-maker');
  await expect(save).toBeDisabled();
});

test('email changes keep the confirmed address while awaiting verification and handle rejection', async ({
  page,
}) => {
  await page.goto('/user/settings');
  await page.getByRole('button', { name: 'อีเมลและรหัสผ่าน', exact: true }).click();
  let rejected = true;
  await page.route('**/auth/v1/user*', (route) => {
    expect(route.request().postDataJSON().email).toBe('new@example.com');
    return rejected
      ? route.fulfill({ status: 422, json: { code: 'email_exists', msg: 'Email unavailable' } })
      : route.fulfill({ json: { id: user.id, email: user.email, new_email: 'new@example.com' } });
  });
  const input = page.getByLabel('อีเมลใหม่', { exact: true });
  const submit = page.getByRole('button', { name: 'ยืนยันเปลี่ยนอีเมล' });
  await input.fill('invalid');
  await expect(submit).toBeDisabled();
  await input.fill('NEW@example.com');
  await submit.click();
  await expect(page.getByText(/เปลี่ยนอีเมลไม่สำเร็จ/)).toBeVisible();
  rejected = false;
  await submit.click();
  await expect(page.getByText('รอการยืนยัน: new@example.com')).toBeVisible();
  await expect(page.locator('.email-current')).toContainText(user.email);
  await expect(input).toHaveValue('');
});

test('password change rejects wrong current password before attempting an update', async ({
  page,
}) => {
  await page.goto('/user/settings');
  await page.getByRole('button', { name: 'อีเมลและรหัสผ่าน', exact: true }).click();
  const session = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('sb-your-project-ref-auth-token')!),
  );
  let rejected = true;
  let updates = 0;
  await page.route('**/auth/v1/token*', (route) =>
    rejected
      ? route.fulfill({
          status: 400,
          json: { code: 'invalid_credentials', msg: 'Invalid credentials' },
        })
      : route.fulfill({ json: session }),
  );
  await page.route('**/auth/v1/user', (route) => {
    updates++;
    expect(route.request().postDataJSON()).toMatchObject({ password: 'NewPassword!123' });
    return route.fulfill({ json: session.user });
  });
  await page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true }).fill('OldPassword!123');
  await page.getByLabel('รหัสผ่านใหม่', { exact: true }).fill('NewPassword!123');
  await page.getByLabel('ยืนยันรหัสผ่านใหม่', { exact: true }).fill('Mismatch!123');
  const submit = page.getByRole('button', { name: 'เปลี่ยนรหัสผ่าน', exact: true });
  await expect(submit).toBeDisabled();
  await page.getByLabel('ยืนยันรหัสผ่านใหม่', { exact: true }).fill('NewPassword!123');
  await submit.click();
  await expect(
    page.getByText('เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาตรวจสอบรหัสผ่านปัจจุบัน'),
  ).toBeVisible();
  expect(updates).toBe(0);
  rejected = false;
  await submit.click();
  await expect(page.getByText('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว')).toBeVisible();
  expect(updates).toBe(1);
  await expect(page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true })).toHaveValue('');
});

test('logout remains reachable from the sidebar', async ({ page }) => {
  await page.goto('/user/settings');
  await page.getByLabel('เมนูบัญชี', { exact: true }).click();
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  expect(await page.evaluate(() => sessionStorage.getItem('iot-hub:account-display'))).toBeNull();
});

test('avatar preview can be cancelled, saved, restored after reload, and removed', async ({
  page,
}) => {
  let image: Buffer | null = null;
  let uploads = 0;
  await page.route('**/api/auth/me/avatar', async (route) => {
    if (route.request().method() === 'PUT') {
      uploads++;
      const body = route.request().postDataBuffer()!;
      const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const start = body.indexOf(signature);
      expect(start).toBeGreaterThan(0);
      const end = body.indexOf(Buffer.from([73, 69, 78, 68, 174, 66, 96, 130]), start) + 8;
      image = body.subarray(start, end);
      expect(image.readUInt32BE(16)).toBe(256);
      expect(image.readUInt32BE(20)).toBe(256);
      return route.fulfill({ status: 204 });
    }
    if (route.request().method() === 'DELETE') {
      image = null;
      return route.fulfill({ status: 204 });
    }
    return image
      ? route.fulfill({ contentType: 'image/png', body: image })
      : route.fulfill({ status: 404 });
  });
  await page.goto('/user/settings');
  const input = page.getByLabel('เลือกรูปโปรไฟล์', { exact: true });
  const file = { name: 'portrait.png', mimeType: 'image/png', buffer: await portraitPng(page) };
  await input.setInputFiles(file);
  await expect(page.getByRole('img', { name: 'ตัวอย่างรูปโปรไฟล์หลังครอป' })).toBeVisible();
  expect(uploads).toBe(0);
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await expect(page.locator('app-avatar-editor img')).toHaveCount(0);
  await expect(page.locator('app-avatar-cropper')).toHaveCount(0);
  await input.setInputFiles(file);
  await page.getByRole('button', { name: 'บันทึกรูป', exact: true }).click();
  await expect(page.getByText('บันทึกรูปโปรไฟล์แล้ว')).toBeVisible();
  await expect(page.locator('.account-card img')).toBeVisible();
  await page.getByRole('button', { name: 'ปรับครอปรูปเดิม' }).click();
  await expect(page.locator('app-avatar-cropper canvas')).toBeVisible();
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await expect(page.locator('.account-card img')).toBeVisible();
  expect(uploads).toBe(1);
  await page.reload();
  await expect(page.locator('app-avatar-editor img')).toBeVisible();
  await expect(page.locator('.account-card img')).toBeVisible();
  await page.getByRole('button', { name: 'ลบรูป', exact: true }).click();
  await expect(page.locator('.account-card img')).toHaveCount(0);
  await expect(page.getByText('ลบรูปโปรไฟล์แล้ว')).toBeVisible();
  await page.reload();
  await expect(page.locator('.account-card')).toContainText('MA');
  await expect(page.locator('app-avatar-editor img')).toHaveCount(0);
});

test('crop position and zoom change the uploaded pixels; drag, reset and mobile layout work', async ({
  page,
}) => {
  await page.goto('/user/settings');
  const buffer = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 40;
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'red';
      context.fillRect(0, 0, 40, 40);
      context.fillStyle = 'blue';
      context.fillRect(40, 0, 40, 40);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
  await page
    .getByLabel('เลือกรูปโปรไฟล์', { exact: true })
    .setInputFiles({ name: 'split.png', mimeType: 'image/png', buffer });
  const canvas = page.locator('app-avatar-cropper canvas');
  const pixel = () =>
    canvas.evaluate((element) =>
      Array.from(
        (element as HTMLCanvasElement).getContext('2d')!.getImageData(128, 128, 1, 1).data,
      ),
    );
  await page.getByLabel('ตำแหน่งแนวนอน', { exact: true }).focus();
  await page.keyboard.press('Home');
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.getByLabel('ซูม', { exact: false }).focus();
  await page.keyboard.press('End');
  await expect(page.locator('#avatar-zoom')).toHaveValue('3');
  await page.getByRole('button', { name: 'คืนค่าการครอป' }).click();
  await expect(page.locator('#avatar-zoom')).toHaveValue('1');
  await expect(page.locator('#avatar-horizontal')).toHaveValue('50');
  await page.getByLabel('ตำแหน่งแนวนอน', { exact: true }).focus();
  await page.keyboard.press('End');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator('app-avatar-cropper')
    .screenshot({ path: '.tmp/account-avatar-crop-mobile.png' });
  await page.route('**/api/auth/me/avatar', async (route) => {
    const body = route.request().postDataBuffer()!;
    const start = body.indexOf(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const end = body.indexOf(Buffer.from([73, 69, 78, 68, 174, 66, 96, 130]), start) + 8;
    const uploadedPixel = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(128, 128, 1, 1).data);
    }, body.subarray(start, end).toString('base64'));
    expect(uploadedPixel).toEqual([0, 0, 255, 255]);
    return route.fulfill({ status: 204 });
  });
  await page.getByRole('button', { name: 'บันทึกรูป', exact: true }).click();
  await expect(page.getByText('บันทึกรูปโปรไฟล์แล้ว')).toBeVisible();
});

test('profile edits can be reset and password visibility clears when switching sections', async ({
  page,
}) => {
  await page.goto('/user/settings');
  const username = page.getByLabel('ชื่อผู้ใช้งาน', { exact: true });
  await username.fill('draft-name');
  await page.getByRole('button', { name: 'ยกเลิกการแก้ไข' }).click();
  await expect(username).toHaveValue(user.username);
  await expect(page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' })).toBeDisabled();
  await page.getByRole('button', { name: 'อีเมลและรหัสผ่าน', exact: true }).click();
  const password = page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true });
  await password.fill('CurrentPassword!1');
  await page.getByLabel('แสดงรหัสผ่าน', { exact: true }).check();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'โปรไฟล์', exact: true }).click();
  await page.getByRole('button', { name: 'อีเมลและรหัสผ่าน', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveValue('CurrentPassword!1');
});

test('display name and bio persist after reload, validate length and can be cleared', async ({
  page,
}) => {
  let savedUser = { ...user, displayName: '', bio: '' };
  await page.route('**/api/auth/me', (route) => {
    if (route.request().method() === 'PATCH')
      savedUser = { ...savedUser, ...route.request().postDataJSON() };
    return route.fulfill({ json: savedUser });
  });
  await page.goto('/user/settings');
  const displayName = page.getByLabel('ชื่อที่แสดง', { exact: true });
  const bio = page.getByLabel('แนะนำตัว', { exact: true });
  const save = page.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' });
  await displayName.fill('นักประดิษฐ์');
  await bio.fill('สนใจ IoT และ ESP32');
  await save.click();
  await expect(page.locator('.account-copy strong')).toHaveText('นักประดิษฐ์');
  await page.reload();
  await expect(displayName).toHaveValue('นักประดิษฐ์');
  await expect(bio).toHaveValue('สนใจ IoT และ ESP32');
  await displayName.evaluate((element) => element.removeAttribute('maxlength'));
  await displayName.fill('a'.repeat(61));
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'ยกเลิกการแก้ไข' }).click();
  await expect(displayName).toHaveValue('นักประดิษฐ์');
  await bio.evaluate((element) => element.removeAttribute('maxlength'));
  await bio.fill('a'.repeat(281));
  await expect(save).toBeDisabled();
  await displayName.fill('');
  await bio.fill('');
  await save.click();
  await expect(page.locator('.account-copy strong')).toHaveText(user.username);
  await page.reload();
  await expect(displayName).toHaveValue('');
  await expect(bio).toHaveValue('');
});

test('loading history uses a static skeleton and switching sections keeps the loaded history', async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/api/auth/login-events', async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204 });
    requests++;
    await pending;
    return route.fulfill({ json: [] });
  });
  await page.goto('/user/settings');
  await page.getByRole('button', { name: 'ประวัติการเข้าสู่ระบบ', exact: true }).click();
  const skeleton = page.locator('app-login-history-settings app-settings-skeleton');
  await expect(skeleton).toBeVisible();
  expect(
    await skeleton.evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  release();
  await expect(page.getByText('ยังไม่มีประวัติการเข้าสู่ระบบ')).toBeVisible();
  await page.getByRole('button', { name: 'โปรไฟล์', exact: true }).click();
  await page.getByRole('button', { name: 'ประวัติการเข้าสู่ระบบ', exact: true }).click();
  await expect(skeleton).toHaveCount(0);
  expect(requests).toBe(1);
  await page.getByRole('button', { name: 'โหลดประวัติใหม่' }).click();
  await expect.poll(() => requests).toBe(2);
});

test('invalid avatars and failed uploads show errors without replacing the saved image', async ({
  page,
}) => {
  await page.goto('/user/settings');
  const input = page.getByLabel('เลือกรูปโปรไฟล์', { exact: true });
  await input.setInputFiles({
    name: 'unsafe.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg />'),
  });
  await expect(page.getByText('เลือกรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB')).toBeVisible();
  await input.setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByText('เปิดรูปนี้ไม่ได้ กรุณาเลือกไฟล์รูปอื่น')).toBeVisible();
  await page.route('**/api/auth/me/avatar', (route) => route.fulfill({ status: 503 }));
  const png = await portraitPng(page);
  await input.setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'บันทึกรูป', exact: true }).click();
  await expect(page.getByText('บันทึกรูปไม่สำเร็จ กรุณาลองอีกครั้ง')).toBeVisible();
  await expect(page.locator('.account-card img')).toHaveCount(0);
});
