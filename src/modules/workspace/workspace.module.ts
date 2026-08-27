import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceFirmwareService } from './workspace-firmware.service';
import { WorkspaceService } from './workspace.service';

@Module({
  imports: [AuthModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceFirmwareService, WorkspaceService],
})
export class WorkspaceModule {}
