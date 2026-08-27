import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../prisma/prisma.service';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

interface AdminUserRecord {
  id: string;
  username: string;
  email: string;
  isActive: boolean;
  createdAt: Date;
  role: { name: string };
  sessions: { createdAt: Date }[];
}

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const users = await this.prisma.db.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        role: { select: { name: true } },
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    return users.map((user) => this.serialize(user));
  }

  async listRoles(): Promise<string[]> {
    const roles = await this.prisma.db.role.findMany({
      orderBy: { name: 'asc' },
      select: { name: true },
    });
    return roles.map((role) => role.name);
  }

  async update(id: string, body: UpdateAdminUserDto) {
    const existing = await this.prisma.db.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('User not found');
    }

    const username = body.username?.trim();
    const email = body.email?.trim().toLowerCase();
    if (username || email) {
      const duplicate = await this.prisma.db.user.findFirst({
        where: {
          id: { not: id },
          OR: [
            ...(username ? [{ username }] : []),
            ...(email ? [{ email }] : []),
          ],
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('Username or email already exists');
      }
    }

    if (body.role) {
      const role = await this.prisma.db.role.findUnique({
        where: { name: body.role },
        select: { id: true },
      });
      if (!role) {
        throw new NotFoundException('Role not found');
      }
    }

    const passwordHash = body.password
      ? await bcrypt.hash(body.password, 10)
      : undefined;

    const updateUser = this.prisma.db.user.update({
      where: { id },
      data: {
        ...(username !== undefined ? { username } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(body.role ? { role: { connect: { name: body.role } } } : {}),
        ...(body.status ? { isActive: body.status === 'active' } : {}),
        ...(passwordHash ? { password: passwordHash } : {}),
      },
      include: {
        role: { select: { name: true } },
        sessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    const shouldRevokeSessions =
      body.status === 'suspended' || passwordHash !== undefined;
    const updated =
      shouldRevokeSessions
        ? (
            await this.prisma.db.$transaction([
              updateUser,
              this.prisma.db.session.updateMany({
                where: { userId: id, revokeAt: null },
                data: { revokeAt: new Date() },
              }),
            ])
          )[0]
        : await updateUser;

    return this.serialize(updated);
  }

  private serialize(user: AdminUserRecord) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role.name,
      status: user.isActive ? ('active' as const) : ('suspended' as const),
      createdAt: user.createdAt,
      lastLoginAt: user.sessions[0]?.createdAt ?? null,
    };
  }
}
