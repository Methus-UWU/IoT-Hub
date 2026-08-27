import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './modules/ai/ai.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AiModule,
    AdminUsersModule,
    WorkspaceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
