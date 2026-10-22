import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AdminIntegrationsController } from './admin-integrations.controller';
import { AdminIntegrationsService } from './admin-integrations.service';
import { AdminMonitoringController } from './admin-monitoring.controller';
import { AdminMonitoringRepository } from './admin-monitoring.repository';
import { AdminMonitoringService } from './admin-monitoring.service';
import { AdminRequestLogStore } from './admin-request-log.store';
import { PrismaAdminMonitoringRepository } from './prisma-admin-monitoring.repository';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

@Module({
  imports: [AuthModule, AuthorizationModule, PrismaModule],
  controllers: [AdminMonitoringController, AdminIntegrationsController],
  providers: [
    AdminMonitoringService,
    AdminIntegrationsService,
    AdminRequestLogStore,
    RequestLoggingInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: RequestLoggingInterceptor,
    },
    {
      provide: AdminMonitoringRepository,
      useClass: PrismaAdminMonitoringRepository,
    },
  ],
})
export class AdminMonitoringModule {}
