import { expect, test, type Page } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

declare global {
  interface Window {
    serialTest: {
      opened: boolean;
      baudRates: number[];
      closed: number;
      emit(text: string): void;
      unplug(): void;
      plug(): void;
    };
  }
}

const projectId = '22222222-2222-4222-8222-222222222222';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '55555555-5555-4555-8555-555555555555';

async function prepare(page: Page) {
  await installAuthenticatedSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('iot-hub:workspace:execution-target', 'hardware');
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let plugged = true;
    const serial = new EventTarget();
    const state = {
      opened: false,
      baudRates: [] as number[],
      closed: 0,
      emit: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
      unplug: () => {
        plugged = false;
        controller.error(new DOMException('Unplugged', 'NetworkError'));
        serial.dispatchEvent(new Event('disconnect'));
      },
      plug: () => {
        plugged = true;
        serial.dispatchEvent(new Event('connect'));
      },
    };
    const port = {
      readable: null as ReadableStream<Uint8Array> | null,
      getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
      open: async ({ baudRate }: { baudRate: number }) => {
        if (state.opened) throw new DOMException('Port already open', 'InvalidStateError');
        if (!plugged) throw new DOMException('Unplugged', 'NetworkError');
        state.opened = true;
        state.baudRates.push(baudRate);
        port.readable = new ReadableStream({
          start: (c) => {
            controller = c;
          },
        });
      },
      close: async () => {
        if (port.readable?.locked) throw new Error('Reader was not released');
        state.opened = false;
        state.closed++;
        port.readable = null;
      },
    };
    Object.assign(serial, {
      getPorts: async () => (plugged ? [port] : []),
      requestPort: async () => port,
    });
    Object.defineProperty(navigator, 'serial', { value: serial, configurable: true });
    window.serialTest = state;
  });
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
          name: 'Serial project',
          slug: 'serial-project',
          description: '',
          board: 'ESP32 DevKit V1',
          framework: 'Arduino',
          createdAt: '2026-10-03T00:00:00Z',
          updatedAt: '2026-10-03T00:00:00Z',
        },
      ]);
    if (path.endsWith('/files'))
      return json([
        {
          path: 'src/main.cpp',
          sizeBytes: 29,
          contentHash: 'mock',
          version: 1,
          updatedAt: '2026-10-03T00:00:00Z',
        },
      ]);
    if (path.endsWith('/file'))
      return json({ path: 'src/main.cpp', content: 'void setup() {}\nvoid loop() {}', version: 1 });
    if (path.endsWith('/usage')) return json({ plan: { code: 'pro', name: 'Pro' }, metrics: [] });
    return json([]);
  });
  await page.goto(`/user/projects/${projectId}/ide`);
  await expect(page.locator('.device-select')).toContainText('CP210x');
}

test('custom baud menu and continuous monitor survive view changes and USB reconnection', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page);
  await page.getByRole('tab', { name: /Serial Monitor/ }).click();
  await expect(page.locator('.serial-status')).toContainText('Connected');
  await expect(page.locator('.serial-toolbar select')).toHaveCount(0);
  const toolbar = page.locator('.serial-toolbar');
  await expect
    .poll(() => toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await expect(page.locator('.serial-connect-button')).toBeInViewport();
  const baud = page.getByRole('combobox', { name: 'ความเร็ว Serial (baud)' });
  await baud.click();
  const option = page.getByRole('option', { name: '9600', exact: true });
  await expect(option).toBeVisible();
  await page.screenshot({ path: '.tmp/serial-dropdown.png', animations: 'disabled' });
  await option.click();
  await expect(baud).toContainText('9600');
  await expect.poll(() => page.evaluate(() => window.serialTest.baudRates)).toEqual([115200, 9600]);
  await expect(page.locator('.serial-status')).toContainText('Connected');
  await page.evaluate(() => window.serialTest.emit('temperature: '));
  await expect(page.locator('.serial-output')).toContainText('temperature:');
  await page.evaluate(() => window.serialTest.emit('25'));
  await expect(page.locator('.serial-output > span')).toHaveCount(1);
  await expect(page.locator('.serial-output > span')).toContainText('temperature: 25');
  await page.evaluate(() => window.serialTest.emit('\r\n'));
  await expect(page.locator('.serial-output > span')).toHaveCount(1);
  await page.evaluate(() => window.serialTest.emit('first line\n'));
  await expect(page.locator('.serial-output')).toContainText('first line');
  await page.getByRole('tab', { name: /Compile output/ }).click();
  await page.evaluate(() => window.serialTest.emit('during build tab\n'));
  await page.getByRole('tab', { name: /Serial Monitor/ }).click();
  await expect(page.locator('.serial-output')).toContainText('during build tab');
  await page.getByRole('button', { name: 'Toggle output panel', exact: true }).click();
  await page.evaluate(() => window.serialTest.emit('while collapsed\n'));
  await page.getByRole('button', { name: 'Toggle output panel', exact: true }).click();
  await expect(page.locator('.serial-output')).toContainText('while collapsed');
  await page.locator(`.workspace-sidebar a[href="/user/projects/${projectId}/documents"]`).click();
  await expect(page.locator('app-documents-page')).toBeVisible();
  await page.evaluate(() => window.serialTest.emit('while reading docs\n'));
  await page.locator(`.workspace-sidebar a[href="/user/projects/${projectId}/ide"]`).click();
  await page.getByRole('tab', { name: /Serial Monitor/ }).click();
  await expect(page.locator('.serial-output')).toContainText('while reading docs');
  await expect.poll(() => page.evaluate(() => window.serialTest.baudRates.length)).toBe(2);
  await page.evaluate(() => window.serialTest.unplug());
  await expect(page.locator('.serial-status')).toContainText('Disconnected');
  await expect(page.locator('.device-select')).toContainText('ถอดออกแล้ว');
  await expect.poll(() => page.evaluate(() => window.serialTest.opened)).toBe(false);
  await page.evaluate(() => window.serialTest.plug());
  await expect(page.locator('.serial-status')).toContainText('Connected');
  await page.evaluate(() => window.serialTest.emit('after USB reconnect\n'));
  await expect(page.locator('.serial-output')).toContainText('after USB reconnect');
  await page.locator('.serial-connect-button').click();
  await expect(page.locator('.serial-status')).toHaveText('Disconnected');
  await page.evaluate(() => window.serialTest.plug());
  await expect.poll(() => page.evaluate(() => window.serialTest.opened)).toBe(false);
  await page.locator('.serial-connect-button').click();
  await expect(page.locator('.serial-status')).toContainText('Connected');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.evaluate(() => window.serialTest.emit('still listening\n'));
  await expect(page.locator('.serial-output')).toContainText('still listening');
  await page.evaluate(() =>
    window.serialTest.emit(Array.from({ length: 2050 }, (_, i) => `sample ${i}`).join('\n') + '\n'),
  );
  await expect(page.locator('.serial-output > span')).toHaveCount(2000);
  await expect(page.locator('.serial-output > span').last()).toContainText('sample 2049');
  await page.locator('.account-menu-trigger').click();
  await page.getByRole('menuitem', { name: 'ออกจากระบบ' }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect.poll(() => page.evaluate(() => window.serialTest.opened)).toBe(false);
  expect(errors).toEqual([]);
});

test('baud selection works with keyboard navigation and switching to simulation releases the port', async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole('tab', { name: /Serial Monitor/ }).click();
  await expect(page.locator('.serial-status')).toContainText('Connected');
  const baud = page.getByRole('combobox', { name: 'ความเร็ว Serial (baud)' });
  await baud.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(baud).toContainText('921600');
  await expect
    .poll(() => page.evaluate(() => window.serialTest.baudRates))
    .toEqual([115200, 921600]);
  await page.getByRole('radio', { name: 'จำลอง', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.serialTest.opened)).toBe(false);
  await expect(page.locator('.serial-status')).toHaveText('Physical device only');
});

test('the device menu re-reads ports in place and remembers the board per project', async ({
  page,
}) => {
  await prepare(page);
  const devices = page.getByRole('combobox', { name: 'เลือกพอร์ต USB ของบอร์ด' });
  await devices.click();
  await page.getByRole('option', { name: /ค้นหาอุปกรณ์อีกครั้ง/ }).click();
  await expect(page.locator('.toolbar-project small')).toContainText(
    'พบอุปกรณ์ที่อนุญาตแล้ว 1 รายการ',
  );
  await devices.click();
  await page.getByRole('option', { name: /เพิ่มอุปกรณ์/ }).click();
  await expect
    .poll(() =>
      page.evaluate((id) => localStorage.getItem(`iot-hub:workspace:${id}:port`), projectId),
    )
    .toBe('10c4:ea60#0');
});
