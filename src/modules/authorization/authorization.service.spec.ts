import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { UserProfile, UserRepository } from '../users/user.repository';
import { WorkspaceRole } from '../workspaces/workspace-role';
import {
  WorkspaceMembership,
  WorkspaceRepository,
} from '../workspaces/workspace.repository';
import { AuthorizationService } from './authorization.service';

const WORKSPACE = 'workspace-a';
const OTHER_WORKSPACE = 'workspace-b';

/** In-memory membership table, keyed the same way the unique index is. */
class FakeWorkspaceRepository extends WorkspaceRepository {
  private readonly memberships = new Map<string, WorkspaceRole>();

  grant(workspaceId: string, userId: string, role: WorkspaceRole): void {
    this.memberships.set(`${workspaceId}:${userId}`, role);
  }

  revoke(workspaceId: string, userId: string): void {
    this.memberships.delete(`${workspaceId}:${userId}`);
  }

  findMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembership | null> {
    const role = this.memberships.get(`${workspaceId}:${userId}`);
    return Promise.resolve(role ? { workspaceId, userId, role } : null);
  }

  listForUser(): Promise<never[]> {
    return Promise.resolve([]);
  }

  findById(): Promise<null> {
    return Promise.resolve(null);
  }

  listMembers(): Promise<never[]> {
    return Promise.resolve([]);
  }

  addMember(): Promise<void> {
    return Promise.resolve();
  }

  updateMemberRole(): Promise<void> {
    return Promise.resolve();
  }

  removeMember(): Promise<void> {
    return Promise.resolve();
  }

  countOwners(): Promise<number> {
    return Promise.resolve(1);
  }
}

class FakeUserRepository extends UserRepository {
  private readonly profiles = new Map<string, UserProfile>();

  set(profile: UserProfile): void {
    this.profiles.set(profile.id, profile);
  }

  findProfileById(id: string): Promise<UserProfile | null> {
    return Promise.resolve(this.profiles.get(id) ?? null);
  }

  findOtherIdByUsernameOrEmail(): Promise<null> {
    return Promise.resolve(null);
  }

  existsByEmail(): Promise<boolean> {
    return Promise.resolve(false);
  }

  existsByUsername(): Promise<boolean> {
    return Promise.resolve(false);
  }

  updateUsername(): Promise<UserProfile> {
    throw new Error('not used');
  }

  count(): Promise<number> {
    return Promise.resolve(this.profiles.size);
  }

  listForAdmin(): Promise<never[]> {
    return Promise.resolve([]);
  }

  exists(id: string): Promise<boolean> {
    return Promise.resolve(this.profiles.has(id));
  }

  updateForAdmin(): Promise<never> {
    throw new Error('not used');
  }
}

function profile(
  id: string,
  overrides: Partial<UserProfile> = {},
): UserProfile {
  return {
    id,
    username: id,
    email: `${id}@example.com`,
    isActive: true,
    role: { name: 'user' },
    ...overrides,
  };
}

describe('AuthorizationService', () => {
  let workspaces: FakeWorkspaceRepository;
  let users: FakeUserRepository;
  let authorization: AuthorizationService;

  beforeEach(() => {
    workspaces = new FakeWorkspaceRepository();
    users = new FakeUserRepository();
    authorization = new AuthorizationService(workspaces, users);

    users.set(profile('alice'));
    users.set(profile('bob'));
    workspaces.grant(WORKSPACE, 'alice', 'owner');
    workspaces.grant(OTHER_WORKSPACE, 'bob', 'owner');
  });

  describe('workspace isolation', () => {
    it("User A cannot reach User B's workspace", async () => {
      await expect(
        authorization.requireWorkspaceRole('alice', OTHER_WORKSPACE, 'viewer'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports a private workspace as not found, never as forbidden', async () => {
      // 403 would confirm the workspace exists, which is itself a disclosure.
      const error = await authorization
        .requireWorkspaceRole('alice', OTHER_WORKSPACE, 'viewer')
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).not.toBeInstanceOf(ForbiddenException);
    });

    it('cannot distinguish a non-member from a non-existent workspace', async () => {
      const nonMember = await authorization
        .requireWorkspaceRole('alice', OTHER_WORKSPACE, 'viewer')
        .catch((thrown: Error) => thrown.message);
      const missing = await authorization
        .requireWorkspaceRole('alice', 'no-such-workspace', 'viewer')
        .catch((thrown: Error) => thrown.message);

      expect(nonMember).toBe(missing);
    });
  });

  describe('role hierarchy', () => {
    it('lets an owner do anything a viewer may do', async () => {
      await expect(
        authorization.requireWorkspaceRole('alice', WORKSPACE, 'viewer'),
      ).resolves.toBe('owner');
    });

    it('refuses a viewer a protected write', async () => {
      workspaces.grant(WORKSPACE, 'bob', 'viewer');

      await expect(
        authorization.requireWorkspaceRole('bob', WORKSPACE, 'editor'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an editor an admin action', async () => {
      workspaces.grant(WORKSPACE, 'bob', 'editor');

      await expect(
        authorization.requireWorkspaceRole('bob', WORKSPACE, 'admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a developer an editor action', async () => {
      workspaces.grant(WORKSPACE, 'bob', 'developer');

      await expect(
        authorization.requireWorkspaceRole('bob', WORKSPACE, 'editor'),
      ).resolves.toBe('developer');
    });
  });

  describe('membership removal', () => {
    it('removes access immediately when a member is removed', async () => {
      workspaces.grant(WORKSPACE, 'bob', 'admin');
      await expect(
        authorization.requireWorkspaceRole('bob', WORKSPACE, 'viewer'),
      ).resolves.toBe('admin');

      workspaces.revoke(WORKSPACE, 'bob');

      await expect(
        authorization.requireWorkspaceRole('bob', WORKSPACE, 'viewer'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('platform admin', () => {
    it('refuses an ordinary user', async () => {
      await expect(
        authorization.requirePlatformAdmin('alice'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an administrator', async () => {
      users.set(profile('root', { role: { name: 'admin' } }));

      await expect(
        authorization.requirePlatformAdmin('root'),
      ).resolves.toBeUndefined();
    });

    it('reads the role from the database, so a demotion takes effect at once', async () => {
      users.set(profile('root', { role: { name: 'admin' } }));
      await authorization.requirePlatformAdmin('root');

      users.set(profile('root', { role: { name: 'user' } }));

      await expect(
        authorization.requirePlatformAdmin('root'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a suspended administrator', async () => {
      users.set(profile('root', { role: { name: 'admin' }, isActive: false }));

      await expect(
        authorization.requirePlatformAdmin('root'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an identity with no profile', async () => {
      await expect(
        authorization.requirePlatformAdmin('ghost'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('account status', () => {
    it('refuses a suspended account', async () => {
      users.set(profile('alice', { isActive: false }));

      await expect(
        authorization.requireActiveAccount('alice'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an active account', async () => {
      await expect(
        authorization.requireActiveAccount('alice'),
      ).resolves.toBeUndefined();
    });
  });
});
