import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { WorkspaceAccessGuard } from './workspace-access.guard';
import { WorkspaceBuildService } from './workspace-build.service';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceDeviceService } from './workspace-device.service';
import { WorkspaceService } from './workspace.service';

@Module({
  imports: [AuthModule],
  controllers: [WorkspaceController],
  providers: [
    WorkspaceAccessGuard,
    WorkspaceBuildService,
    WorkspaceDeviceService,
    WorkspaceService,
  ],
})
export class WorkspaceModule {}
