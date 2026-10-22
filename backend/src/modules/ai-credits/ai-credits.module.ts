import { Module } from '@nestjs/common';

import { AiCreditsRepository } from './ai-credits.repository';
import { AiCreditsService } from './ai-credits.service';
import { PrismaAiCreditsRepository } from './prisma-ai-credits.repository';

/**
 * AI settings and credits. A module of its own so both the AI module (which enforces
 * and records credits) and billing (which reports them) can use it without depending
 * on each other.
 */
@Module({
  providers: [
    AiCreditsService,
    { provide: AiCreditsRepository, useClass: PrismaAiCreditsRepository },
  ],
  exports: [AiCreditsService],
})
export class AiCreditsModule {}
