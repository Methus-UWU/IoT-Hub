import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ProjectsModule } from '../projects/projects.module';
import {
  DashboardRepository,
  DashboardTemplateRepository,
} from './dashboard.repository';
import { DashboardTemplatesService } from './dashboard-templates.service';
import {
  DashboardTemplatesController,
  DashboardsController,
} from './dashboards.controller';
import { DashboardsService } from './dashboards.service';
import {
  PrismaDashboardRepository,
  PrismaDashboardTemplateRepository,
} from './prisma-dashboard.repository';

@Module({
  imports: [AuthModule, AuthorizationModule, ProjectsModule],
  controllers: [DashboardsController, DashboardTemplatesController],
  providers: [
    DashboardsService,
    DashboardTemplatesService,
    { provide: DashboardRepository, useClass: PrismaDashboardRepository },
    {
      provide: DashboardTemplateRepository,
      useClass: PrismaDashboardTemplateRepository,
    },
  ],
  exports: [DashboardsService],
})
export class DashboardsModule {}
