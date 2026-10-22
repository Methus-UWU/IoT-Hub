import { createClient } from '@supabase/supabase-js';

import { SupabaseConfig } from '../../common/config/supabase.config';
import { SupabaseAdminService } from './supabase-admin.service';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

describe('Supabase user activity', () => {
  const listUsers = jest.fn();
  const getUserById = jest.fn();
  let service: SupabaseAdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(createClient).mockReturnValue({
      auth: { admin: { listUsers, getUserById } },
    } as unknown as ReturnType<typeof createClient>);
    service = new SupabaseAdminService({
      canPerformAdminOperations: true,
      url: 'https://example.supabase.co',
      secretKey: 'test-only',
    } as SupabaseConfig);
  });

  it('reads last sign-in timestamps across every identity page', async () => {
    listUsers
      .mockResolvedValueOnce({
        data: {
          users: [
            { id: 'user-1', last_sign_in_at: '2026-09-28T10:00:00.000Z' },
          ],
          nextPage: 2,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          users: [{ id: 'user-2', last_sign_in_at: undefined }],
          nextPage: null,
        },
        error: null,
      });

    await expect(service.listUserLastSignIns()).resolves.toEqual(
      new Map([
        ['user-1', '2026-09-28T10:00:00.000Z'],
        ['user-2', null],
      ]),
    );
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 1000 });
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1000 });
  });

  it('reads one user after an administrator updates their profile', async () => {
    getUserById.mockResolvedValue({
      data: {
        user: { id: 'user-1', last_sign_in_at: '2026-09-28T10:00:00.000Z' },
      },
      error: null,
    });

    await expect(service.getUserLastSignIn('user-1')).resolves.toBe(
      '2026-09-28T10:00:00.000Z',
    );
  });

  it('returns a safe service error when the identity provider rejects a read', async () => {
    listUsers.mockResolvedValue({
      data: { users: [] },
      error: { message: 'provider detail' },
    });

    await expect(service.listUserLastSignIns()).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'SUPABASE_ADMIN_FAILED',
        message: 'The identity provider could not return account activity',
      },
    });
  });
});
