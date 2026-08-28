import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { AuthorizationModule } from '../authorization/authorization.module';
import { UsersModule } from '../users/users.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [AuthModule, AuthorizationModule, UsersModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, SupabaseAdminService],
})
export class AdminUsersModule {}
