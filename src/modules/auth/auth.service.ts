import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';

import { UserProfile, UserRepository } from '../users/user.repository';
import { RoleRepository } from '../users/role.repository';
import {
  ACCESS_TOKEN_LIFETIME,
  PASSWORD_HASH_ROUNDS,
  REFRESH_TOKEN_HASH_ROUNDS,
  REFRESH_TOKEN_LIFETIME,
  REFRESH_TOKEN_LIFETIME_MS,
} from './auth.constants';
import {
  ChangePasswordDto,
  CheckExistDto,
  LoginDto,
  SignUpDto,
  UpdateProfileDto,
} from './dto';
import { SessionRepository } from './session.repository';

interface RequestMetadata {
  ip?: string;
  userAgent?: string;
}

interface RefreshTokenPayload {
  sub: string;
  sid: string;
  type: 'refresh';
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly sessions: SessionRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(body: LoginDto, metadata: RequestMetadata): Promise<TokenPair> {
    const user = await this.users.findCredentialsByEmail(
      body.email.toLowerCase(),
    );

    // One response for every failure mode, so the endpoint cannot be used to
    // discover which addresses have accounts or which accounts are suspended.
    if (
      !user ||
      !user.isActive ||
      !(await bcrypt.compare(body.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    const sessionId = randomUUID();
    const tokens = await this.createTokenPair(
      { id: user.id, email: user.email, role: user.roleName },
      sessionId,
    );

    await this.sessions.create({
      id: sessionId,
      userId: user.id,
      ip: metadata.ip,
      agentDevice: metadata.userAgent,
      refreshTokenHash: await bcrypt.hash(
        tokens.refreshToken,
        REFRESH_TOKEN_HASH_ROUNDS,
      ),
      expireAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS),
    });

    return tokens;
  }

  async refresh(
    refreshToken: string,
    metadata: RequestMetadata,
  ): Promise<TokenPair> {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh' || !payload.sid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.sessions.findByIdWithUser(payload.sid);
    const validSession =
      session &&
      session.userId === payload.sub &&
      session.user.isActive &&
      !session.revokeAt &&
      session.expireAt.getTime() > Date.now() &&
      (await bcrypt.compare(refreshToken, session.refreshTokenHash));

    if (!validSession) {
      throw new UnauthorizedException('Refresh session is no longer valid');
    }

    const tokens = await this.createTokenPair(
      {
        id: session.user.id,
        email: session.user.email,
        role: session.user.roleName,
      },
      session.id,
    );

    await this.sessions.rotate(session.id, {
      ip: metadata.ip,
      agentDevice: metadata.userAgent,
      refreshTokenHash: await bcrypt.hash(
        tokens.refreshToken,
        REFRESH_TOKEN_HASH_ROUNDS,
      ),
      expireAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS),
    });

    return tokens;
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;

    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
          ignoreExpiration: true,
        },
      );

      if (payload.sid) await this.sessions.revoke(payload.sid);
    } catch {
      // An invalid cookie still gets cleared by the controller.
    }
  }

  async signUp(body: SignUpDto): Promise<void> {
    const username = body.username.trim();
    const email = body.email.trim().toLowerCase();

    const existingId = await this.users.findIdByUsernameOrEmail(
      username,
      email,
    );
    if (existingId) {
      throw new ConflictException('Username or email already exists');
    }

    const role = await this.roles.findByName('user');
    if (!role) {
      throw new ConflictException('Default user role is not configured');
    }

    await this.users.create({
      username,
      email,
      passwordHash: await bcrypt.hash(body.password, PASSWORD_HASH_ROUNDS),
      roleId: role.id,
    });
  }

  async checkExists(body: CheckExistDto): Promise<{ exists: boolean }> {
    const value = body.value.trim();
    const exists =
      body.field === 'email'
        ? await this.users.existsByEmail(value.toLowerCase())
        : await this.users.existsByUsername(value);

    return { exists };
  }

  async getMe(userId: string): Promise<UserProfile> {
    const user = await this.users.findProfileById(userId);

    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }

    return user;
  }

  async updateMe(userId: string, body: UpdateProfileDto): Promise<UserProfile> {
    const username = body.username.trim();
    const email = body.email.trim().toLowerCase();

    const duplicateId = await this.users.findOtherIdByUsernameOrEmail(userId, {
      username,
      email,
    });
    if (duplicateId) {
      throw new ConflictException('Username or email already exists');
    }

    return this.users.updateProfile(userId, { username, email });
  }

  async changePassword(
    userId: string,
    sessionId: string | undefined,
    body: ChangePasswordDto,
  ): Promise<void> {
    const passwordHash = await this.users.findPasswordHashById(userId);

    if (
      !passwordHash ||
      !(await bcrypt.compare(body.currentPassword, passwordHash))
    ) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (await bcrypt.compare(body.newPassword, passwordHash)) {
      throw new BadRequestException('New password must be different');
    }

    await this.users.changePassword(
      userId,
      await bcrypt.hash(body.newPassword, PASSWORD_HASH_ROUNDS),
      sessionId,
    );
  }

  private async createTokenPair(
    user: { id: string; email: string; role: string },
    sessionId: string,
  ): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          sid: sessionId,
          type: 'access',
        },
        {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          expiresIn: ACCESS_TOKEN_LIFETIME,
        },
      ),
      this.jwt.signAsync(
        { sub: user.id, sid: sessionId, type: 'refresh' },
        {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
          expiresIn: REFRESH_TOKEN_LIFETIME,
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }
}
