import type { Page } from '@playwright/test';

export async function installAuthenticatedSession(
  page: Page,
  options: { provider?: string; providers?: string[]; methods?: string[] } = {},
): Promise<void> {
  const userId = '55555555-5555-4555-8555-555555555555';
  const base64Url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url({
    sub: userId,
    email: 'e2e@example.com',
    role: 'authenticated',
    aud: 'authenticated',
    exp: 4_102_444_800,
    amr: (options.methods ?? ['password']).map((method) => ({ method, timestamp: 1_700_000_000 })),
  })}.c2lnbmF0dXJl`;
  await page.addInitScript(
    ({ storageKey, session }) => localStorage.setItem(storageKey, JSON.stringify(session)),
    {
      storageKey: 'sb-your-project-ref-auth-token',
      session: {
        access_token: token,
        refresh_token: 'e2e-refresh-token',
        expires_at: 4_102_444_800,
        expires_in: 2_147_483_647,
        token_type: 'bearer',
        user: {
          id: userId,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'e2e@example.com',
          app_metadata: {
            provider: options.provider ?? 'email',
            providers: options.providers ?? [options.provider ?? 'email'],
          },
          user_metadata: {},
          identities: [],
          created_at: '2026-01-01T00:00:00.000Z',
        },
      },
    },
  );
}
