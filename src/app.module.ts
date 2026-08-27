import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { THROTTLE_RULES } from './common/config/security.config';
import { RequestIdMiddleware } from './common/http/request-id.middleware';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // One global tier, enforced by ThrottlerGuard. Expensive routes tighten it
    // per handler with @Throttle(THROTTLE_OVERRIDES.auth) and friends; declaring
    // the stricter tiers here would instead apply them to every endpoint.
    ThrottlerModule.forRoot([THROTTLE_RULES.default]),
    PrismaModule,
    AuthModule,
    AiModule,
    AdminUsersModule,
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
