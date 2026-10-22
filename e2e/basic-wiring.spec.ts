import { expect, test } from '@playwright/test';

test('opens the wiring guide, follows a wire, and reads individual schematics', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/docs');
  await page.getByRole('searchbox').fill('วงจรตัวอย่าง');
  const article = page.getByRole('button', { name: /ภาพตัวอย่างการต่ออุปกรณ์พื้นฐาน/ });
  await article.click();
  const reader = page.getByRole('dialog');
  const example = reader.locator('app-wiring-gallery');
  await expect(example.getByRole('img')).toBeVisible();
  const wire = example.getByRole('button', { name: /GPIO 23 → ตัวต้านทาน ขา 1/ });
  await wire.focus();
  await page.keyboard.press('Enter');
  await expect(wire).toHaveAttribute('aria-pressed', 'true');
  await expect(example.locator('svg g.selected')).toHaveCount(1);
  await expect(example.locator('svg g.muted')).toHaveCount(7);
  await page.keyboard.press('Enter');
  await expect(wire).toHaveAttribute('aria-pressed', 'false');
  await expect(example.locator('svg g.muted')).toHaveCount(0);
  const picker = example.getByRole('group', { name: 'เลือกตัวอย่างวงจร' });
  await expect(picker.getByRole('button')).toHaveCount(11);
  await picker.getByRole('button', { name: /อุณหภูมิ DHT22/ }).click();
  await expect(example.getByRole('heading', { name: /DHT22/ })).toBeVisible();
  await expect(example.locator('.connection-list button')).toHaveCount(5);
  await example.getByRole('button', { name: /GPIO 23 → ตัวต้านทาน ขาล่าง/ }).click();
  await expect(example.locator('svg g.muted')).toHaveCount(4);
  await picker.getByRole('button', { name: /จอ OLED I2C/ }).click();
  await expect(example.locator('svg g.muted')).toHaveCount(0);
  await expect(example.locator('.connection-list button')).toHaveCount(4);
  await reader.getByText('ดูแผนผังแยกแต่ละวงจร', { exact: true }).click();
  const image = reader.locator('.guide-illustration img');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(960);
  await page.keyboard.press('Escape');
  await expect(reader).not.toBeVisible();
  await expect(article).toBeFocused();
  expect(errors).toEqual([]);
});

test('keeps the mobile reader within the viewport while the enlarged circuit scrolls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs');
  await page.getByRole('button', { name: /ภาพตัวอย่างการต่ออุปกรณ์พื้นฐาน/ }).click();
  const reader = page.getByRole('dialog');
  const example = reader.locator('app-wiring-gallery');
  const scroll = example.getByRole('region', { name: 'ภาพวงจร เลื่อนดูได้เมื่อขยาย' });
  await expect(scroll).toBeVisible();
  await expect
    .poll(() => reader.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await example.getByRole('button', { name: 'ขยายภาพ', exact: true }).click();
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true);
  await expect
    .poll(() => reader.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await scroll.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await example.getByRole('button', { name: 'ย่อภาพ', exact: true }).click();
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
});
