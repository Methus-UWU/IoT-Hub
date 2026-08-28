import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { EntitlementService } from './entitlement.service';
import { PlanRepository } from './plan.repository';
import { PrismaPlanRepository } from './prisma-plan.repository';

@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [
    EntitlementService,
    { provide: PlanRepository, useClass: PrismaPlanRepository },
  ],
  exports: [EntitlementService],
})
export class BillingModule {}
