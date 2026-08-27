import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { RoleRepository } from '../users/role.repository';
import { UserRepository } from '../users/user.repository';
import { AuthService } from './auth.service';
import {
  CreateSessionInput,
  RotateSessionInput,
  SessionRepository,
  SessionWithUser,
} from './session.repository';

const ACCESS_SECRET = 'test-access-secret';
const REFRESH_SECRET = 'test-refresh-secret';
const PASSWORD = 'correct horse battery';

const config = {
  getOrThrow: (key: string) =>
    key === 'JWT_REFRESH_SECRET' ? REFRESH_SECRET : ACCESS_SECRET,
} as unknown as ConfigService;

/**
 * In-memory session store. Repositories are abstract classes with no Prisma in
 * their signatures, which is what lets these tests run without a database — the
 * point of the Phase 1 seam.
 */
class FakeSessionRepository extends SessionRepository {
  readonly created: CreateSessionInput[] = [];
  readonly rotated: { id: string; input: RotateSessionInput }[] = [];
  readonly revoked: string[] = [];
  session: SessionWithUser | null = null;

  create(input: CreateSessionInput): Promise<void> {
    this.created.push(input);
    return Promise.resolve();
  }

  findByIdWithUser(id: string): Promise<SessionWithUser | null> {
    return Promise.resolve(this.session?.id === id ? this.session : null);
  }

  rotate(id: string, input: RotateSessionInput): Promise<void> {
    this.rotated.push({ id, input });
    return Promise.resolve();
  }

  revoke(id: string): Promise<void> {
    this.revoked.push(id);
    return Promise.resolve();
  }

  countActive(): Promise<number> {
    return Promise.resolve(0);
  }
}

describe('AuthService', () => {
  const jwt = new JwtService({});
  let passwordHash: string;
  // Held as locals too: asserting on `users.method` directly trips the
  // unbound-method lint rule, and binding at the assertion site reads worse.
  let findCredentialsByEmail: jest.Mock;
  let findPasswordHashById: jest.Mock;
  let changePassword: jest.Mock;
  let users: jest.Mocked<UserRepository>;
  let roles: jest.Mocked<RoleRepository>;
  let sessions: FakeSessionRepository;
  let service: AuthService;

  beforeAll(async () => {
    // Hashed once: bcrypt is deliberately slow.
    passwordHash = await bcrypt.hash(PASSWORD, 4);
  });

  beforeEach(() => {
    findCredentialsByEmail = jest.fn();
    findPasswordHashById = jest.fn();
    changePassword = jest.fn();

    users = {
      findCredentialsByEmail,
      findProfileById: jest.fn(),
      findIdByUsernameOrEmail: jest.fn(),
      findOtherIdByUsernameOrEmail: jest.fn(),
      existsByEmail: jest.fn(),
      existsByUsername: jest.fn(),
      create: jest.fn(),
      updateProfile: jest.fn(),
      findPasswordHashById,
      changePassword,
      count: jest.fn(),
      listForAdmin: jest.fn(),
      exists: jest.fn(),
      updateForAdmin: jest.fn(),
    };

    roles = {
      findByName: jest.fn(),
      listNames: jest.fn(),
    };

    sessions = new FakeSessionRepository();
    service = new AuthService(users, roles, sessions, jwt, config);
  });

  const activeUser = {
    id: 'user-1',
    email: 'user@example.com',
    isActive: true,
    roleName: 'user',
  };

  describe('login', () => {
    it('rejects an unknown email', async () => {
      findCredentialsByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: PASSWORD }, {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a suspended account even with the right password', async () => {
      findCredentialsByEmail.mockResolvedValue({
        ...activeUser,
        isActive: false,
        passwordHash,
      });

      await expect(
        service.login({ email: activeUser.email, password: PASSWORD }, {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessions.created).toHaveLength(0);
    });

    it('rejects a wrong password', async () => {
      findCredentialsByEmail.mockResolvedValue({
        ...activeUser,
        passwordHash,
      });

      await expect(
        service.login({ email: activeUser.email, password: 'wrong' }, {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('gives the same message whether the account exists or the password is wrong', async () => {
      findCredentialsByEmail.mockResolvedValue(null);
      const unknownAccount = await service
        .login({ email: 'nobody@example.com', password: PASSWORD }, {})
        .catch((error: Error) => error.message);

      findCredentialsByEmail.mockResolvedValue({
        ...activeUser,
        passwordHash,
      });
      const wrongPassword = await service
        .login({ email: activeUser.email, password: 'wrong' }, {})
        .catch((error: Error) => error.message);

      expect(unknownAccount).toBe(wrongPassword);
    });

    it('stores the refresh token hashed, never in clear text', async () => {
      findCredentialsByEmail.mockResolvedValue({
        ...activeUser,
        passwordHash,
      });

      const tokens = await service.login(
        { email: activeUser.email, password: PASSWORD },
        { ip: '203.0.113.4', userAgent: 'jest' },
      );

      expect(sessions.created).toHaveLength(1);
      const stored = sessions.created[0];
      expect(stored.refreshTokenHash).not.toBe(tokens.refreshToken);
      await expect(
        bcrypt.compare(tokens.refreshToken, stored.refreshTokenHash),
      ).resolves.toBe(true);
    });

    it('lowercases the email before looking the account up', async () => {
      findCredentialsByEmail.mockResolvedValue({
        ...activeUser,
        passwordHash,
      });

      await service.login(
        { email: 'User@Example.COM', password: PASSWORD },
        {},
      );

      expect(findCredentialsByEmail).toHaveBeenCalledWith('user@example.com');
    });
  });

  describe('refresh', () => {
    async function issueRefreshToken(
      overrides: Partial<{ sub: string; sid: string; type: string }> = {},
    ): Promise<string> {
      return jwt.signAsync(
        { sub: 'user-1', sid: 'session-1', type: 'refresh', ...overrides },
        { secret: REFRESH_SECRET, expiresIn: '7d' },
      );
    }

    async function storedSession(
      token: string,
      overrides: Partial<SessionWithUser> = {},
    ): Promise<SessionWithUser> {
      return {
        id: 'session-1',
        userId: 'user-1',
        refreshTokenHash: await bcrypt.hash(token, 4),
        expireAt: new Date(Date.now() + 60_000),
        revokeAt: null,
        user: activeUser,
        ...overrides,
      };
    }

    it('rejects a token signed with the access secret', async () => {
      const token = await jwt.signAsync(
        { sub: 'user-1', sid: 'session-1', type: 'refresh' },
        { secret: ACCESS_SECRET, expiresIn: '7d' },
      );

      await expect(service.refresh(token, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an access token presented as a refresh token', async () => {
      const token = await issueRefreshToken({ type: 'access' });
      sessions.session = await storedSession(token);

      await expect(service.refresh(token, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a revoked session', async () => {
      const token = await issueRefreshToken();
      sessions.session = await storedSession(token, { revokeAt: new Date() });

      await expect(service.refresh(token, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an expired session', async () => {
      const token = await issueRefreshToken();
      sessions.session = await storedSession(token, {
        expireAt: new Date(Date.now() - 1),
      });

      await expect(service.refresh(token, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a session belonging to a different user', async () => {
      const token = await issueRefreshToken({ sub: 'someone-else' });
      sessions.session = await storedSession(token);

      await expect(service.refresh(token, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a token that does not match the stored hash', async () => {
      // Everything else lines up — same user, same session, not revoked, not
      // expired — so this fails only on the token comparison. That is the case
      // where a previously issued token is replayed after rotation.
      const token = await issueRefreshToken();
      sessions.session = await storedSession('a-previously-rotated-token');

      await expect(service.refresh(token, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(sessions.rotated).toHaveLength(0);
    });

    it('rejects a suspended user', async () => {
      const token = await issueRefreshToken();
      sessions.session = await storedSession(token, {
        user: { ...activeUser, isActive: false },
      });

      await expect(service.refresh(token, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rotates the stored hash on success', async () => {
      const token = await issueRefreshToken();
      sessions.session = await storedSession(token);

      const tokens = await service.refresh(token, {});

      expect(sessions.rotated).toHaveLength(1);
      const rotated = sessions.rotated[0];
      expect(rotated.id).toBe('session-1');
      await expect(
        bcrypt.compare(tokens.refreshToken, rotated.input.refreshTokenHash),
      ).resolves.toBe(true);
    });
  });

  describe('logout', () => {
    it('revokes the session named by the token', async () => {
      const token = await jwt.signAsync(
        { sub: 'user-1', sid: 'session-1', type: 'refresh' },
        { secret: REFRESH_SECRET, expiresIn: '7d' },
      );

      await service.logout(token);

      expect(sessions.revoked).toEqual(['session-1']);
    });

    it('revokes an expired token, so logging out always clears the session', async () => {
      const token = await jwt.signAsync(
        { sub: 'user-1', sid: 'session-1', type: 'refresh' },
        { secret: REFRESH_SECRET, expiresIn: '-1s' },
      );

      await service.logout(token);

      expect(sessions.revoked).toEqual(['session-1']);
    });

    it('ignores a forged token', async () => {
      await service.logout('not-a-jwt');

      expect(sessions.revoked).toEqual([]);
    });
  });

  describe('changePassword', () => {
    it('rejects a wrong current password', async () => {
      findPasswordHashById.mockResolvedValue(passwordHash);

      await expect(
        service.changePassword('user-1', 'session-1', {
          currentPassword: 'wrong',
          newPassword: 'Another-password-1!',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(changePassword).not.toHaveBeenCalled();
    });

    it('refuses to set the same password again', async () => {
      findPasswordHashById.mockResolvedValue(passwordHash);

      await expect(
        service.changePassword('user-1', 'session-1', {
          currentPassword: PASSWORD,
          newPassword: PASSWORD,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('keeps the current session and lets the repository revoke the rest', async () => {
      findPasswordHashById.mockResolvedValue(passwordHash);

      await service.changePassword('user-1', 'session-1', {
        currentPassword: PASSWORD,
        newPassword: 'Another-password-1!',
      });

      expect(changePassword).toHaveBeenCalledTimes(1);
      const call = changePassword.mock.calls[0] as [
        string,
        string,
        string | undefined,
      ];
      const [userId, newHash, keepSessionId] = call;
      expect(userId).toBe('user-1');
      expect(keepSessionId).toBe('session-1');
      // The service must hand the repository a hash, not the new password.
      expect(newHash).not.toBe('Another-password-1!');
      await expect(
        bcrypt.compare('Another-password-1!', newHash),
      ).resolves.toBe(true);
    });
  });
});
