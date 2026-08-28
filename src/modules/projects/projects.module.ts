import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { BillingModule } from '../billing/billing.module';
import { BoardsController } from './boards.controller';
import { PrismaProjectComponentRepository } from './prisma-project-component.repository';
import {
  PrismaProjectFileRepository,
  PrismaProjectRepository,
} from './prisma-project.repository';
import { ProjectComponentsService } from './project-components.service';
import { ProjectFilesService } from './project-files.service';
import {
  ProjectComponentRepository,
  ProjectFileRepository,
  ProjectRepository,
} from './project.repository';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuthModule, AuthorizationModule, BillingModule],
  controllers: [ProjectsController, BoardsController],
  providers: [
    ProjectsService,
    ProjectFilesService,
    ProjectComponentsService,
    { provide: ProjectRepository, useClass: PrismaProjectRepository },
    { provide: ProjectFileRepository, useClass: PrismaProjectFileRepository },
    {
      provide: ProjectComponentRepository,
      useClass: PrismaProjectComponentRepository,
    },
  ],
  exports: [ProjectsService, ProjectFilesService, ProjectComponentsService],
})
export class ProjectsModule {}
