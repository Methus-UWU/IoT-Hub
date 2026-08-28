import { Module, forwardRef } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuthorizationService } from './authorization.service';
import { PlatformAdminGuard } from './platform-admin.guard';

@Module({
  imports: [UsersModule, forwardRef(() => WorkspacesModule)],
  providers: [AuthorizationService, PlatformAdminGuard],
  exports: [AuthorizationService, PlatformAdminGuard],
})
export class AuthorizationModule {}
