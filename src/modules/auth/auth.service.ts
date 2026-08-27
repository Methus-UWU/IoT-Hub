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

import { PrismaService } from '../../prisma/prisma.service';
import {
  ChangePasswordDto,
  CheckExistDto,
  LoginDto,
  SignUpDto,
  UpdateProfileDto,
} from './dto';

const ACCESS_TOKEN_LIFETIME = '15m';
const REFRESH_TOKEN_LIFETIME = '7d';
const REFRESH_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

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
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(body: LoginDto, metadata: RequestMetadata): Promise<TokenPair> {
    const user = await this.prisma.db.user.findUnique({
      where: { email: body.email.toLowerCase() },
      include: { role: true },
    });

    if (
      !user ||
      !user.isActive ||
      !(await bcrypt.compare(body.password, user.password))
    ) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    const sessionId = randomUUID();
    const tokens = await this.createTokenPair(
      { id: user.id, email: user.email, role: user.role.name },
      sessionId,
    );

    await this.prisma.db.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        ip: metadata.ip,
        agentDevice: metadata.userAgent,
        refreshToken: await bcrypt.hash(tokens.refreshToken, 10),
        expireAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS),
      },
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

    const session = await this.prisma.db.session.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { role: true } } },
    });

    const validSession =
      session &&
      session.userId === payload.sub &&
      session.user.isActive &&
      !session.revokeAt &&
      session.expireAt.getTime() > Date.now() &&
      (await bcrypt.compare(refreshToken, session.refreshToken));

    if (!validSession) {
      throw new UnauthorizedException('Refresh session is no longer valid');
    }

    const tokens = await this.createTokenPair(
      {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role.name,
      },
      session.id,
    );

    await this.prisma.db.session.update({
      where: { id: session.id },
      data: {
        ip: metadata.ip,
        agentDevice: metadata.userAgent,
        refreshToken: await bcrypt.hash(tokens.refreshToken, 10),
        expireAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS),
      },
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

      if (payload.sid) {
        await this.prisma.db.session.updateMany({
          where: { id: payload.sid, revokeAt: null },
          data: { revokeAt: new Date() },
        });
      }
    } catch {
      // An invalid cookie still gets cleared by the controller.
    }
  }

  async signUp(body: SignUpDto): Promise<void> {
    const username = body.username.trim();
    const email = body.email.trim().toLowerCase();
    const existing = await this.prisma.db.user.findFirst({
      where: { OR: [{ username }, { email }] },
    });

    if (existing) {
      throw new ConflictException('Username or email already exists');
    }

    const role = await this.prisma.db.role.findUnique({
      where: { name: 'user' },
    });
    if (!role) {
      throw new ConflictException('Default user role is not configured');
    }

    await this.prisma.db.user.create({
      data: {
        username,
        email,
        password: await bcrypt.hash(body.password, 10),
        roleId: role.id,
      },
    });
  }

  async checkExists(body: CheckExistDto): Promise<{ exists: boolean }> {
    const value = body.value.trim();
    const user = await this.prisma.db.user.findFirst({
      where:
        body.field === 'email'
          ? { email: value.toLowerCase() }
          : { username: value },
      select: { id: true },
    });

    return { exists: Boolean(user) };
  }

  async getMe(userId: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        isActive: true,
        role: { select: { name: true } },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }

    return user;
  }

  async updateMe(userId: string, body: UpdateProfileDto) {
    const username = body.username.trim();
    const email = body.email.trim().toLowerCase();
    const duplicate = await this.prisma.db.user.findFirst({
      where: {
        id: { not: userId },
        OR: [{ username }, { email }],
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException('Username or email already exists');
    }

    return this.prisma.db.user.update({
      where: { id: userId },
      data: { username, email },
      select: {
        id: true,
        username: true,
        email: true,
        isActive: true,
        role: { select: { name: true } },
      },
    });
  }

  async changePassword(
    userId: string,
    sessionId: string | undefined,
    body: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });

    if (!user || !(await bcrypt.compare(body.currentPassword, user.password))) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (await bcrypt.compare(body.newPassword, user.password)) {
      throw new BadRequestException('New password must be different');
    }

    const updatePassword = this.prisma.db.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(body.newPassword, 10) },
    });

    if (!sessionId) {
      await updatePassword;
      return;
    }

    await this.prisma.db.$transaction([
      updatePassword,
      this.prisma.db.session.updateMany({
        where: { userId, id: { not: sessionId }, revokeAt: null },
        data: { revokeAt: new Date() },
      }),
    ]);
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
