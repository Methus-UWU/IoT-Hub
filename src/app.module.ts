import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { THROTTLE_RULES } from './common/config/security.config';
import { SupabaseModule } from './common/config/supabase.module';
import { RequestIdMiddleware } from './common/http/request-id.middleware';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { AdminDatabaseModule } from './modules/admin-database/admin-database.module';
import { AdminMonitoringModule } from './modules/admin-monitoring/admin-monitoring.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { SearchHistoryModule } from './modules/search-history/search-history.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { BillingModule } from './modules/billing/billing.module';
import { BuildModule } from './modules/build/build.module';
import { CommunityModule } from './modules/community/community.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { LibrariesModule } from './modules/libraries/libraries.module';
import { DevicesModule } from './modules/devices/devices.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // One global tier, enforced by ThrottlerGuard. Expensive routes tighten it
    // per handler with @Throttle(THROTTLE_OVERRIDES.auth) and friends; declaring
    // the stricter tiers here would instead apply them to every endpoint.
    ThrottlerModule.forRoot([THROTTLE_RULES.default]),
    SupabaseModule,
    PrismaModule,
    AuthModule,
    AuthorizationModule,
    WorkspacesModule,
    ProjectsModule,
    DashboardsModule,
    LibrariesModule,
    DevicesModule,
    BillingModule,
    BuildModule,
    CommunityModule,
    SearchHistoryModule,
    AiModule,
    AdminUsersModule,
    AdminDatabaseModule,
    AdminMonitoringModule,
    WorkspaceModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
