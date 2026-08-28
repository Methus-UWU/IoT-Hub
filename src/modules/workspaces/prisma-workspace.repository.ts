import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { isWorkspaceRole, WorkspaceRole } from './workspace-role';
import {
  Workspace,
  WorkspaceMembership,
  WorkspaceRepository,
  WorkspaceSummary,
} from './workspace.repository';

/**
 * The database CHECK constraint already restricts the column, so an unknown value
 * means the two definitions have drifted. Failing loudly beats silently treating it
 * as the least-privileged role, which would hide the drift.
 */
function toRole(value: string): WorkspaceRole {
  if (!isWorkspaceRole(value)) {
    throw new Error(`Unknown workspace role stored in the database: ${value}`);
  }
  return value;
}

@Injectable()
export class PrismaWorkspaceRepository extends WorkspaceRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembership | null> {
    const membership = await this.prisma.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { workspaceId: true, userId: true, role: true },
    });

    if (!membership) return null;

    return {
      workspaceId: membership.workspaceId,
      userId: membership.userId,
      role: toRole(membership.role),
    };
  }

  async listForUser(userId: string): Promise<WorkspaceSummary[]> {
    const memberships = await this.prisma.db.workspaceMember.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        workspace: {
          select: { id: true, name: true, slug: true, ownerId: true },
        },
      },
    });

    return memberships.map((membership) => ({
      ...membership.workspace,
      role: toRole(membership.role),
    }));
  }

  findById(workspaceId: string): Promise<Workspace | null> {
    return this.prisma.db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, slug: true, ownerId: true },
    });
  }

  async listMembers(workspaceId: string) {
    const members = await this.prisma.db.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true,
        role: true,
        user: { select: { username: true, email: true } },
      },
    });

    return members.map((member) => ({
      userId: member.userId,
      username: member.user.username,
      email: member.user.email,
      role: toRole(member.role),
    }));
  }

  async addMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<void> {
    await this.prisma.db.workspaceMember.create({
      data: { workspaceId, userId, role },
    });
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<void> {
    await this.prisma.db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { role },
    });
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await this.prisma.db.workspaceMember.deleteMany({
      where: { workspaceId, userId },
    });
  }

  countOwners(workspaceId: string): Promise<number> {
    return this.prisma.db.workspaceMember.count({
      where: { workspaceId, role: 'owner' },
    });
  }
}
