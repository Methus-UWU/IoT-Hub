import { BadRequestException, ConflictException } from '@nestjs/common';

import { SignInIpRepository } from '../auth/sign-in-ip.repository';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { AdminUserView, UserRepository } from '../users/user.repository';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService user activity', () => {
  const existingUser: AdminUserView = {
    id: 'user-1',
    username: 'tester',
    email: 'tester@example.com',
    role: 'user',
    status: 'active',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  const users = {
    listForAdmin: jest.fn(),
    exists: jest.fn(),
    findOtherIdByUsernameOrEmail: jest.fn(),
    updateForAdmin: jest.fn(),
    existsByUsername: jest.fn(),
    existsByEmail: jest.fn(),
  };
  const roles = { findByName: jest.fn(), listNames: jest.fn() };
  const supabaseAdmin = {
    listUserLastSignIns: jest.fn(),
    getUserLastSignIn: jest.fn(),
    setBanned: jest.fn(),
    createUser: jest.fn(),
    deleteUser: jest.fn(),
  };
  const signInIps = { listLatest: jest.fn(), findLatest: jest.fn() };
  let service: AdminUsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    users.listForAdmin.mockResolvedValue([existingUser]);
    users.exists.mockResolvedValue(true);
    users.updateForAdmin.mockResolvedValue(existingUser);
    signInIps.listLatest.mockResolvedValue(new Map());
    signInIps.findLatest.mockResolvedValue(null);
    service = new AdminUsersService(
      users as unknown as UserRepository,
      roles,
      supabaseAdmin as unknown as SupabaseAdminService,
      signInIps as unknown as SignInIpRepository,
    );
    users.existsByUsername.mockResolvedValue(false);
    users.existsByEmail.mockResolvedValue(false);
  });

  it('adds the real Supabase last sign-in time and address to the admin list', async () => {
    supabaseAdmin.listUserLastSignIns.mockResolvedValue(
      new Map([['user-1', '2026-09-28T10:00:00.000Z']]),
    );
    signInIps.listLatest.mockResolvedValue(
      new Map([['user-1', '203.0.113.7']]),
    );

    await expect(service.list()).resolves.toEqual([
      {
        ...existingUser,
        lastLoginAt: '2026-09-28T10:00:00.000Z',
        lastLoginIp: '203.0.113.7',
        lastLoginAvailable: true,
      },
    ]);
  });

  it('marks activity unavailable instead of claiming the user never signed in', async () => {
    supabaseAdmin.listUserLastSignIns.mockRejectedValue(
      new Error('identity provider unavailable'),
    );

    await expect(service.list()).resolves.toEqual([
      {
        ...existingUser,
        lastLoginAt: null,
        lastLoginIp: null,
        lastLoginAvailable: false,
      },
    ]);
  });

  it('still lists sign-in times when session addresses cannot be read', async () => {
    supabaseAdmin.listUserLastSignIns.mockResolvedValue(
      new Map([['user-1', '2026-09-28T10:00:00.000Z']]),
    );
    signInIps.listLatest.mockRejectedValue(new Error('permission denied'));

    await expect(service.list()).resolves.toEqual([
      {
        ...existingUser,
        lastLoginAt: '2026-09-28T10:00:00.000Z',
        lastLoginIp: null,
        lastLoginAvailable: true,
      },
    ]);
  });

  it('keeps last sign-in data after an administrator updates a user', async () => {
    supabaseAdmin.getUserLastSignIn.mockResolvedValue(
      '2026-09-28T10:00:00.000Z',
    );
    signInIps.findLatest.mockResolvedValue('203.0.113.7');

    await expect(service.update('admin-1', 'user-1', {})).resolves.toEqual({
      ...existingUser,
      lastLoginAt: '2026-09-28T10:00:00.000Z',
      lastLoginIp: '203.0.113.7',
      lastLoginAvailable: true,
    });
  });

  it('creates the identity, then applies a non-default role', async () => {
    roles.findByName.mockResolvedValue({ name: 'admin' });
    supabaseAdmin.createUser.mockResolvedValue('new-user');
    const body = {
      email: 'new@example.com',
      username: 'newbie',
      password: 'long-enough',
      role: 'admin',
    };

    await service.create(body);

    expect(supabaseAdmin.createUser).toHaveBeenCalledWith({
      email: body.email,
      password: body.password,
      username: body.username,
    });
    expect(users.updateForAdmin).toHaveBeenCalledWith('new-user', {
      roleName: 'admin',
    });
  });

  it('refuses a taken username before touching the identity provider', async () => {
    users.existsByUsername.mockResolvedValue(true);

    await expect(
      service.create({
        email: 'new@example.com',
        username: 'tester',
        password: 'long-enough',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(supabaseAdmin.createUser).not.toHaveBeenCalled();
  });

  it('deletes another account through the identity provider', async () => {
    await service.delete('admin-1', 'user-1');
    expect(supabaseAdmin.deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('refuses to delete the acting administrator', async () => {
    await expect(service.delete('admin-1', 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(supabaseAdmin.deleteUser).not.toHaveBeenCalled();
  });
});
