import { expect, test, type Page } from '@playwright/test';
import { installAuthenticatedSession } from './support/auth-session';

const projectId = '99999999-9999-4999-8999-999999999999';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '55555555-5555-4555-8555-555555555555';
const oldChat = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const newChat = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const debugProfile = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const systemProfile = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

interface Server {
  role: 'user' | 'admin';
  chats: Record<string, unknown>[];
  created: unknown[];
  chatRequests: Record<string, unknown>[];
  patches: { path: string; body: unknown }[];
  deleted: string[];
  profilesCreated: unknown[];
  imported: { path: string; body: unknown }[];
  releaseList?: () => void;
  releaseMessages?: () => void;
}

const profiles = () => [
  {
    id: systemProfile,
    name: 'IoT Assistant',
    description: 'Platform default',
    model: null,
    tier: 'balanced',
    instructions: '',
    scope: 'system',
    editable: false,
    updatedAt: '2026-10-11T00:00:00Z',
  },
  {
    id: debugProfile,
    name: 'Debug Assistant',
    description: 'Finds bugs first',
    model: 'vendor/debugger',
    tier: 'deep',
    instructions: 'Find the bug first.',
    scope: 'personal',
    editable: true,
    updatedAt: '2026-10-11T00:00:00Z',
  },
];

async function prepare(
  page: Page,
  options: { role?: 'user' | 'admin'; slow?: boolean } = {},
): Promise<Server> {
  const server: Server = {
    role: options.role ?? 'user',
    chats: [
      {
        id: oldChat,
        title: 'Add a DHT22',
        profileId: null,
        createdAt: '2026-10-10T00:00:00Z',
        updatedAt: '2026-10-10T00:00:00Z',
        messageCount: 2,
      },
    ],
    created: [],
    chatRequests: [],
    patches: [],
    deleted: [],
    profilesCreated: [],
    imported: [],
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
        id: userId,
        username: 'maker',
        email: 'e2e@example.com',
        isActive: true,
        role: { name: server.role },
      });
    if (path === '/api/auth/me/avatar') return json({ code: 'AVATAR_NOT_FOUND' }, 404);
    if (path === '/api/workspaces')
      return json([
        { id: workspaceId, name: 'Workspace', slug: 'workspace', ownerId: userId, role: 'owner' },
      ]);
    if (path === `/api/workspaces/${workspaceId}/projects`)
      return json([
        {
          id: projectId,
          workspaceId,
          name: 'Greenhouse',
          slug: 'greenhouse',
          description: '',
          board: 'ESP32 DevKit V1',
          framework: 'Arduino',
          createdAt: '2026-10-03T00:00:00Z',
          updatedAt: '2026-10-03T00:00:00Z',
        },
      ]);
    if (path === '/api/ai/profiles' && method === 'GET') return json(profiles());
    if (path === '/api/ai/profiles' && method === 'POST') {
      server.profilesCreated.push(request.postDataJSON());
      return json({ ...profiles()[1], id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
    }
    const conversations = `/api/workspaces/${workspaceId}/projects/${projectId}/ai/conversations`;
    if (path === `${conversations}/import` && method === 'POST') {
      server.imported.push({ path, body: request.postDataJSON() });
      return json({
        id: newChat,
        title: 'Old blink chat',
        profileId: null,
        createdAt: '2026-10-11T00:00:00Z',
        updatedAt: '2026-10-11T00:00:00Z',
      });
    }
    if (path === conversations && method === 'GET') {
      if (options.slow) await new Promise<void>((resolve) => (server.releaseList = resolve));
      return json(server.chats);
    }
    if (path === conversations && method === 'POST') {
      server.created.push(request.postDataJSON());
      const chat = {
        id: newChat,
        title: '',
        profileId: (request.postDataJSON() as { profileId: string | null }).profileId,
        createdAt: '2026-10-11T00:00:00Z',
        updatedAt: '2026-10-11T00:00:00Z',
      };
      server.chats.unshift(chat);
      return json(chat);
    }
    if (path === `${conversations}/${oldChat}` && method === 'GET') {
      if (options.slow) await new Promise<void>((resolve) => (server.releaseMessages = resolve));
      return json({
        ...server.chats.find((chat) => chat['id'] === oldChat),
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Add a DHT22',
            plan: null,
            planState: null,
            planError: null,
            model: null,
            createdAt: '2026-10-10T00:00:00Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Stored answer about the DHT22',
            plan: null,
            planState: null,
            planError: null,
            model: 'ranked/model',
            createdAt: '2026-10-10T00:00:01Z',
          },
        ],
      });
    }
    if (path.startsWith(`${conversations}/`) && method === 'PATCH') {
      server.patches.push({ path, body: request.postDataJSON() });
      return json({ ...server.chats[0], ...(request.postDataJSON() as object) });
    }
    if (path.startsWith(`${conversations}/`) && method === 'DELETE') {
      server.deleted.push(path.split('/').at(-1)!);
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/ai/chat')) {
      server.chatRequests.push(request.postDataJSON() as Record<string, unknown>);
      return json({
        id: 'turn',
        model: 'ranked/model',
        vendor: 'test',
        profile: 'balanced',
        autoSelected: true,
        content: 'Fresh answer from the server',
        createdAt: '2026-10-11T00:00:00Z',
        conversationId: newChat,
        messageId: 'm4',
        userMessageId: 'm3',
      });
    }
    if (path.endsWith('/files'))
      return json([
        {
          path: 'src/main.cpp',
          sizeBytes: 10,
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
  return server;
}

test('conversations load from the server behind skeletons and a new chat is stored without a profile picker', async ({
  page,
}) => {
  const server = await prepare(page, { slow: true });
  await page.goto(`/user/projects/${projectId}/ide`);
  const panel = page.getByRole('complementary', { name: 'ผู้ช่วยเขียนโค้ด AI' });

  await expect(panel.locator('.ai-picker-skeleton')).toBeVisible();
  await expect.poll(() => Boolean(server.releaseList)).toBe(true);
  server.releaseList!();
  // The most recent conversation reopens; its messages load behind a skeleton.
  await expect(panel.locator('.chat-skeleton')).toBeVisible();
  await expect.poll(() => Boolean(server.releaseMessages)).toBe(true);
  server.releaseMessages!();
  await expect(panel).toContainText('Stored answer about the DHT22');
  await expect(panel.locator('.chat-skeleton')).toHaveCount(0);

  // The IDE chat has no AI profile control.
  await expect(panel.getByRole('combobox', { name: 'เลือก AI Profile' })).toHaveCount(0);
  await expect(panel.locator('.ai-profile-copy')).toContainText('ผู้ช่วยพัฒนาโปรเจกต์ของคุณ');

  // A new chat: nothing is created until the first question.
  await panel.getByRole('button', { name: 'แชทใหม่' }).click();
  expect(server.created).toEqual([]);

  await panel.getByRole('textbox').fill('Why does the relay chatter?');
  await panel.getByRole('button', { name: 'ส่งข้อความ' }).click();
  await expect(panel).toContainText('Fresh answer from the server');
  expect(server.created).toEqual([{ profileId: null }]);
  expect(server.chatRequests).toHaveLength(1);
  expect(server.chatRequests[0]).toMatchObject({
    conversationId: newChat,
    messages: [{ role: 'user', content: 'Why does the relay chatter?' }],
  });

  await panel.getByRole('button', { name: 'ลบบทสนทนานี้' }).click();
  await expect.poll(() => server.deleted).toEqual([newChat]);
  await expect(panel).not.toContainText('Fresh answer from the server');
});

for (const role of ['user', 'admin'] as const) {
  test(`account settings no longer exposes AI profiles for ${role}`, async ({ page }) => {
    await prepare(page, { role });
    await page.goto(role === 'admin' ? '/admin/profile?section=ai' : '/user/settings?section=ai');
    await expect(page.getByRole('heading', { name: 'โปรไฟล์ของคุณ' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI Profiles', exact: true })).toHaveCount(0);
    await expect(page.locator('app-ai-profiles-settings')).toHaveCount(0);
  });
}

test('conversations kept in the tab before the update are imported into the open project only on request', async ({
  page,
}) => {
  const server = await prepare(page);
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'iot-hub:workspace:ai-sessions:v1',
      JSON.stringify({
        activeSessionId: 'old',
        sessions: [
          {
            id: 'old',
            title: 'Old blink chat',
            updatedAt: 1,
            messages: [
              {
                id: 1,
                role: 'assistant',
                text: 'พร้อมช่วยคุณพัฒนาเฟิร์มแวร์ เซนเซอร์ การต่อวงจร และ Web API วันนี้อยากเริ่มจากอะไร?',
              },
              { id: 2, role: 'user', text: 'Blink the LED' },
              { id: 3, role: 'assistant', text: 'Here is a sketch' },
            ],
          },
          { id: 'empty', title: 'แชทใหม่', updatedAt: 2, messages: [] },
        ],
      }),
    );
  });
  await page.goto(`/user/projects/${projectId}/ide`);
  const banner = page.locator('.ai-legacy-banner');
  await expect(banner).toContainText('พบแชทเก่า 1 รายการ');
  expect(server.imported).toEqual([]);

  await banner.getByRole('button', { name: 'นำเข้าโปรเจกต์นี้' }).click();
  await expect(banner).toHaveCount(0);
  expect(server.imported).toEqual([
    {
      path: `/api/workspaces/${workspaceId}/projects/${projectId}/ai/conversations/import`,
      body: {
        title: 'Old blink chat',
        messages: [
          { role: 'user', content: 'Blink the LED' },
          { role: 'assistant', content: 'Here is a sketch' },
        ],
      },
    },
  ]);
  expect(
    await page.evaluate(() => sessionStorage.getItem('iot-hub:workspace:ai-sessions:v1')),
  ).toBeNull();
});
