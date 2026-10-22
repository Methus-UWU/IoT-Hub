import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OptionalSupabaseAuthGuard } from './optional-supabase-auth.guard';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { LoginHistoryRepository } from './login-history.repository';
import { LoginHistoryService } from './login-history.service';
import { PrismaLoginHistoryRepository } from './prisma-login-history.repository';
import { PrismaSignInIpRepository } from './prisma-sign-in-ip.repository';
import { SignInIpRepository } from './sign-in-ip.repository';
import { SupabaseAdminService } from './supabase-admin.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController, AvatarController],
  providers: [
    AuthService,
    SupabaseAuthGuard,
    OptionalSupabaseAuthGuard,
    AvatarService,
    SupabaseAdminService,
    LoginHistoryService,
    { provide: LoginHistoryRepository, useClass: PrismaLoginHistoryRepository },
    { provide: SignInIpRepository, useClass: PrismaSignInIpRepository },
  ],
  exports: [
    SupabaseAuthGuard,
    OptionalSupabaseAuthGuard,
    LoginHistoryService,
    SignInIpRepository,
  ],
})
export class AuthModule {}
