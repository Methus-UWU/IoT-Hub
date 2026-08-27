import { Module } from '@nestjs/common';

import { AdminRoleGuard } from '../../common/guards/admin-role.guard';
import { AuthModule } from '../auth/auth.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, AdminRoleGuard],
})
export class AdminUsersModule {}
