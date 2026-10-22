import { Module, forwardRef } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PrismaWorkspaceRepository } from './prisma-workspace.repository';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspacesController } from './workspaces.controller';

/**
 * AuthorizationModule imports this module for the repository, and this module
 * needs AuthorizationService for its controller. forwardRef resolves that cycle
 * without either side reaching around the other.
 */
@Module({
  imports: [AuthModule, forwardRef(() => AuthorizationModule)],
  controllers: [WorkspacesController],
  providers: [
    { provide: WorkspaceRepository, useClass: PrismaWorkspaceRepository },
  ],
  exports: [WorkspaceRepository],
})
export class WorkspacesModule {}
