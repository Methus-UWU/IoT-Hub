import { Module } from '@nestjs/common';

import { PrismaWorkspaceRepository } from './prisma-workspace.repository';
import { WorkspaceRepository } from './workspace.repository';

@Module({
  providers: [
    { provide: WorkspaceRepository, useClass: PrismaWorkspaceRepository },
  ],
  exports: [WorkspaceRepository],
})
export class WorkspacesModule {}
