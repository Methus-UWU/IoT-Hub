import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrismaSearchHistoryRepository } from './prisma-search-history.repository';
import { SearchHistoryController } from './search-history.controller';
import { SearchHistoryRepository } from './search-history.repository';
import { SearchHistoryService } from './search-history.service';

@Module({
  imports: [AuthModule],
  controllers: [SearchHistoryController],
  providers: [
    SearchHistoryService,
    {
      provide: SearchHistoryRepository,
      useClass: PrismaSearchHistoryRepository,
    },
  ],
})
export class SearchHistoryModule {}
