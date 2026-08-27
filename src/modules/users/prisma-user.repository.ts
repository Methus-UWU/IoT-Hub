import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  AdminUserView,
  CreateUserInput,
  UpdateAdminUserInput,
  UserCredentials,
  UserProfile,
  UserRepository,
} from './user.repository';

/** Shape shared by the two admin-facing queries, kept in one place. */
const ADMIN_VIEW_SELECT = {
  id: true,
  username: true,
  email: true,
  isActive: true,
  createdAt: true,
  role: { select: { name: true } },
  sessions: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { createdAt: true },
  },
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
  sessions: { createdAt: Date }[];
}

@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const user = await this.prisma.db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        isActive: true,
        role: { select: { name: true } },
      },
    });

    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      passwordHash: user.password,
      isActive: user.isActive,
      roleName: user.role.name,
    };
  }

  findProfileById(id: string): Promise<UserProfile | null> {
    return this.prisma.db.user.findUnique({
      where: { id },
      select: PROFILE_SELECT,
    });
  }

  async findIdByUsernameOrEmail(
    username: string,
    email: string,
  ): Promise<string | null> {
    const user = await this.prisma.db.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { id: true },
    });
    return user?.id ?? null;
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

  async create(input: CreateUserInput): Promise<void> {
    await this.prisma.db.user.create({
      data: {
        username: input.username,
        email: input.email,
        password: input.passwordHash,
        roleId: input.roleId,
      },
    });
  }

  updateProfile(
    id: string,
    input: { username: string; email: string },
  ): Promise<UserProfile> {
    return this.prisma.db.user.update({
      where: { id },
      data: { username: input.username, email: input.email },
      select: PROFILE_SELECT,
    });
  }

  async findPasswordHashById(id: string): Promise<string | null> {
    const user = await this.prisma.db.user.findUnique({
      where: { id },
      select: { password: true },
    });
    return user?.password ?? null;
  }

  async changePassword(
    id: string,
    passwordHash: string,
    keepSessionId: string | undefined,
  ): Promise<void> {
    const updatePassword = this.prisma.db.user.update({
      where: { id },
      data: { password: passwordHash },
    });

    if (!keepSessionId) {
      await updatePassword;
      return;
    }

    await this.prisma.db.$transaction([
      updatePassword,
      this.prisma.db.session.updateMany({
        where: { userId: id, id: { not: keepSessionId }, revokeAt: null },
        data: { revokeAt: new Date() },
      }),
    ]);
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
    const updateUser = this.prisma.db.user.update({
      where: { id },
      data: {
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.roleName
          ? { role: { connect: { name: input.roleName } } }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.passwordHash ? { password: input.passwordHash } : {}),
      },
      select: ADMIN_VIEW_SELECT,
    });

    // Losing access must not depend on a second round trip succeeding.
    const revokeSessions =
      input.isActive === false || input.passwordHash !== undefined;

    if (!revokeSessions) {
      return toAdminUserView(await updateUser);
    }

    const [updated] = await this.prisma.db.$transaction([
      updateUser,
      this.prisma.db.session.updateMany({
        where: { userId: id, revokeAt: null },
        data: { revokeAt: new Date() },
      }),
    ]);

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
    lastLoginAt: user.sessions[0]?.createdAt ?? null,
  };
}
