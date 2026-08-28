import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import {
  PrismaProjectFileRepository,
  PrismaProjectRepository,
} from './prisma-project.repository';
import { ProjectFilesService } from './project-files.service';
import { ProjectFileRepository, ProjectRepository } from './project.repository';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    ProjectFilesService,
    { provide: ProjectRepository, useClass: PrismaProjectRepository },
    { provide: ProjectFileRepository, useClass: PrismaProjectFileRepository },
  ],
  exports: [ProjectsService, ProjectFilesService],
})
export class ProjectsModule {}
