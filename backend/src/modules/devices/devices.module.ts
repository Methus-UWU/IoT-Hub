import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { ProjectsModule } from '../projects/projects.module';
import { DeviceRepository } from './device.repository';
import { DeviceTokenGuard } from './device-token.guard';
import { DeviceApiController, DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { PrismaDeviceRepository } from './prisma-device.repository';
import { TelemetryService } from './telemetry.service';

/** Devices and their telemetry (ADR-008). */
@Module({
  imports: [AuthModule, AuthorizationModule, ProjectsModule, DashboardsModule],
  controllers: [DevicesController, DeviceApiController],
  providers: [
    DevicesService,
    TelemetryService,
    DeviceTokenGuard,
    { provide: DeviceRepository, useClass: PrismaDeviceRepository },
  ],
})
export class DevicesModule {}
