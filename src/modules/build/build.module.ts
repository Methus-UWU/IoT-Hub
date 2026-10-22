import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { BillingModule } from '../billing/billing.module';
import { ProjectsModule } from '../projects/projects.module';
import { BuildJobRepository } from './build-job.repository';
import { BuildWorkerController } from './build-worker.controller';
import { BuildWorkerGuard } from './build-worker.guard';
import { BuildWorkerService } from './build-worker.service';
import { BuildsController } from './builds.controller';
import { BuildsService } from './builds.service';
import { PrismaBuildJobRepository } from './prisma-build-job.repository';

/**
 * Firmware builds (Phase 4, docs/adr/ADR-002-build-isolation.md).
 *
 * This module queues builds and records results. It never compiles anything and
 * imports no process-spawning API: compilation happens in the isolated builder
 * container that the separate dispatcher process starts.
 */
@Module({
  imports: [AuthModule, AuthorizationModule, BillingModule, ProjectsModule],
  controllers: [BuildsController, BuildWorkerController],
  providers: [
    BuildsService,
    BuildWorkerService,
    BuildWorkerGuard,
    { provide: BuildJobRepository, useClass: PrismaBuildJobRepository },
  ],
})
export class BuildModule {}
