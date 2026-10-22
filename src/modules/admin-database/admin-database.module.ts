import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AdminDatabaseController } from './admin-database.controller';
import { AdminDatabaseService } from './admin-database.service';
import { DatabaseOverviewRepository } from './database-overview.repository';
import { PrismaDatabaseOverviewRepository } from './prisma-database-overview.repository';

@Module({
  imports: [AuthModule, AuthorizationModule, PrismaModule],
  controllers: [AdminDatabaseController],
  providers: [
    AdminDatabaseService,
    {
      provide: DatabaseOverviewRepository,
      useClass: PrismaDatabaseOverviewRepository,
    },
  ],
})
export class AdminDatabaseModule {}
