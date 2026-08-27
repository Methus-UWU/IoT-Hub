import { Module } from '@nestjs/common';

import { PrismaRoleRepository } from './prisma-role.repository';
import { PrismaUserRepository } from './prisma-user.repository';
import { RoleRepository } from './role.repository';
import { UserRepository } from './user.repository';

/**
 * Binds the user and role persistence contracts to their Prisma implementations.
 *
 * This module is the only place that decides which database technology backs those
 * contracts. Changing that decision — see docs/adr/ADR-001-database-access.md —
 * means editing the two `useClass` bindings below and nothing else.
 */
@Module({
  providers: [
    { provide: UserRepository, useClass: PrismaUserRepository },
    { provide: RoleRepository, useClass: PrismaRoleRepository },
  ],
  exports: [UserRepository, RoleRepository],
})
export class UsersModule {}
