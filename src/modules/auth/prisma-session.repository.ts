import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateSessionInput,
  RotateSessionInput,
  SessionRepository,
  SessionWithUser,
} from './session.repository';

@Injectable()
export class PrismaSessionRepository extends SessionRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: CreateSessionInput): Promise<void> {
    await this.prisma.db.session.create({
      data: {
        id: input.id,
        userId: input.userId,
        ip: input.ip,
        agentDevice: input.agentDevice,
        refreshToken: input.refreshTokenHash,
        expireAt: input.expireAt,
      },
    });
  }

  async findByIdWithUser(id: string): Promise<SessionWithUser | null> {
    const session = await this.prisma.db.session.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        refreshToken: true,
        expireAt: true,
        revokeAt: true,
        user: {
          select: {
            id: true,
            email: true,
            isActive: true,
            role: { select: { name: true } },
          },
        },
      },
    });

    if (!session) return null;

    return {
      id: session.id,
      userId: session.userId,
      refreshTokenHash: session.refreshToken,
      expireAt: session.expireAt,
      revokeAt: session.revokeAt,
      user: {
        id: session.user.id,
        email: session.user.email,
        isActive: session.user.isActive,
        roleName: session.user.role.name,
      },
    };
  }

  async rotate(id: string, input: RotateSessionInput): Promise<void> {
    await this.prisma.db.session.update({
      where: { id },
      data: {
        ip: input.ip,
        agentDevice: input.agentDevice,
        refreshToken: input.refreshTokenHash,
        expireAt: input.expireAt,
      },
    });
  }

  async revoke(id: string): Promise<void> {
    // updateMany, not update: revoking an already-revoked or unknown session is a
    // no-op rather than an error, because logout must always succeed.
    await this.prisma.db.session.updateMany({
      where: { id, revokeAt: null },
      data: { revokeAt: new Date() },
    });
  }

  countActive(): Promise<number> {
    return this.prisma.db.session.count({
      where: { revokeAt: null, expireAt: { gt: new Date() } },
    });
  }
}
