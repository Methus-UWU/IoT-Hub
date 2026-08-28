import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  AdminUserView,
  UpdateAdminUserInput,
  UserProfile,
  UserRepository,
} from './user.repository';

const ADMIN_VIEW_SELECT = {
  id: true,
  username: true,
  email: true,
  isActive: true,
  createdAt: true,
  role: { select: { name: true } },
} as const;

const PROFILE_SELECT = {
  id: true,
  username: true,
  email: true,
  isActive: true,
  role: { select: { name: true } },
} as const;

interface AdminUserRow {
  id: string;
  username: string;
  email: string;
  isActive: boolean;
  createdAt: Date;
  role: { name: string };
}

@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findProfileById(id: string): Promise<UserProfile | null> {
    return this.prisma.db.user.findUnique({
      where: { id },
      select: PROFILE_SELECT,
    });
  }

  async findOtherIdByUsernameOrEmail(
    excludedUserId: string,
    criteria: { username?: string; email?: string },
  ): Promise<string | null> {
    const alternatives = [
      ...(criteria.username ? [{ username: criteria.username }] : []),
      ...(criteria.email ? [{ email: criteria.email }] : []),
    ];

    if (alternatives.length === 0) return null;

    const user = await this.prisma.db.user.findFirst({
      where: { id: { not: excludedUserId }, OR: alternatives },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  async existsByEmail(email: string): Promise<boolean> {
    const user = await this.prisma.db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return user !== null;
  }

  async existsByUsername(username: string): Promise<boolean> {
    const user = await this.prisma.db.user.findUnique({
      where: { username },
      select: { id: true },
    });
    return user !== null;
  }

  updateUsername(id: string, username: string): Promise<UserProfile> {
    return this.prisma.db.user.update({
      where: { id },
      data: { username },
      select: PROFILE_SELECT,
    });
  }

  count(): Promise<number> {
    return this.prisma.db.user.count();
  }

  async listForAdmin(): Promise<AdminUserView[]> {
    const users = await this.prisma.db.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: ADMIN_VIEW_SELECT,
    });

    return users.map((user) => toAdminUserView(user));
  }

  async exists(id: string): Promise<boolean> {
    const user = await this.prisma.db.user.findUnique({
      where: { id },
      select: { id: true },
    });
    return user !== null;
  }

  async updateForAdmin(
    id: string,
    input: UpdateAdminUserInput,
  ): Promise<AdminUserView> {
    const updated = await this.prisma.db.user.update({
      where: { id },
      data: {
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.roleName
          ? { role: { connect: { name: input.roleName } } }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: ADMIN_VIEW_SELECT,
    });

    return toAdminUserView(updated);
  }
}

function toAdminUserView(user: AdminUserRow): AdminUserView {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role.name,
    status: user.isActive ? 'active' : 'suspended',
    createdAt: user.createdAt,
  };
}
