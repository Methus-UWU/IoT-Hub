import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/docs');
  await page.getByRole('tab', { name: 'ข้อมูลอุปกรณ์' }).click();
});

test('compares devices across filters, enforces the limit, and restores keyboard focus', async ({
  page,
}) => {
  const compare = page.getByRole('button', { name: /^เปรียบเทียบ \(\d\)$/ });
  const search = page.getByRole('searchbox');
  const tray = page.getByRole('region', { name: 'รายการเปรียบเทียบอุปกรณ์' });
  await expect(compare).toBeDisabled();

  await search.fill('DHT22');
  await page.locator('.device-compare-button').click();
  await expect(compare).toBeDisabled();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await search.fill('');
  await page
    .locator('.category-panel')
    .getByRole('button', { name: /^จอแสดงผล/ })
    .click();
  await page.locator('.device-compare-button').first().click();
  await expect(compare).toBeEnabled();
  await page
    .locator('.category-panel')
    .getByRole('button', { name: /^แสงสว่าง/ })
    .click();
  await page.locator('.device-compare-button').first().click();
  await page
    .locator('.category-panel')
    .getByRole('button', { name: /^ไมโครคอนโทรลเลอร์/ })
    .click();
  await page.locator('.device-compare-button').first().click();
  await expect(compare).toHaveText('เปรียบเทียบ (4)');
  await expect(page.locator('.device-compare-button').nth(1)).toBeDisabled();
  await expect(page.locator('.device-compare-button').first()).toBeEnabled();

  await page.getByRole('tab', { name: 'คู่มือ', exact: true }).click();
  await page.getByRole('tab', { name: 'ข้อมูลอุปกรณ์' }).click();
  await expect(compare).toHaveText('เปรียบเทียบ (4)');
  await search.fill('no-matching-device');
  await expect(page.getByText('ไม่พบอุปกรณ์ที่ตรงกับที่ค้นหา')).toBeVisible();
  await compare.click();
  const dialog = page.getByRole('dialog', { name: 'เปรียบเทียบอุปกรณ์' });
  const close = dialog.getByRole('button', { name: 'ปิดการเปรียบเทียบ' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('columnheader')).toHaveCount(5);
  await expect(dialog.getByRole('rowheader', { name: 'จุดเด่น / ความสามารถ' })).toBeVisible();
  await expect(dialog.getByRole('rowheader', { name: 'ข้อจำกัด / ข้อควรระวัง' })).toBeVisible();
  await expect(dialog.getByText(/อุปกรณ์ต่างหมวดมีหน้าที่ต่างกัน/)).toBeVisible();
  await expect(dialog.getByText(/อ่านค่าถี่กว่า 2 วินาทีต่อครั้งไม่ได้/)).toBeVisible();
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(compare).toBeFocused();

  await tray.getByRole('button', { name: /^นำ .*DHT22.*ออกจากการเปรียบเทียบ$/ }).click();
  await expect(compare).toHaveText('เปรียบเทียบ (3)');
  await search.fill('');
  await expect(page.locator('.device-compare-button').nth(1)).toBeEnabled();
  await tray.getByRole('button', { name: 'ล้างทั้งหมด' }).click();
  await expect(compare).toBeDisabled();
  await expect(page.locator('.device-compare-button[aria-pressed="true"]')).toHaveCount(0);
  await page.locator('.device-details-button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('same-category comparison works on mobile and marks missing limitations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('searchbox').fill('Arduino');
  const cards = page.locator('.device-card');
  await cards.filter({ hasText: 'Arduino Nano' }).locator('.device-compare-button').click();
  await cards.filter({ hasText: 'Arduino Mega' }).locator('.device-compare-button').click();
  await page.getByRole('button', { name: 'เปรียบเทียบ (2)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'เปรียบเทียบอุปกรณ์' });
  await expect(dialog.getByText(/อุปกรณ์ต่างหมวดมีหน้าที่ต่างกัน/)).toHaveCount(0);
  await expect(dialog.getByText(/ยังไม่มีข้อมูลข้อจำกัด/)).toHaveCount(1);
  expect(
    await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth;
    }),
  ).toBe(true);
  const scroll = dialog.getByRole('region');
  expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await scroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await page.screenshot({ path: 'test-results/device-comparison-mobile.png' });
  await dialog.getByRole('button', { name: 'ปิดการเปรียบเทียบ' }).click();
  await expect(dialog).not.toBeVisible();
});
