import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { Role, RoleRepository } from './role.repository';

@Injectable()
export class PrismaRoleRepository extends RoleRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findByName(name: string): Promise<Role | null> {
    return this.prisma.db.role.findUnique({
      where: { name },
      select: { id: true, name: true },
    });
  }

  async listNames(): Promise<string[]> {
    const roles = await this.prisma.db.role.findMany({
      orderBy: { name: 'asc' },
      select: { name: true },
    });
    return roles.map((role) => role.name);
  }
}
