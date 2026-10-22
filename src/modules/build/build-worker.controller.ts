import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { BuildWorkerGuard } from './build-worker.guard';
import { BuildWorkerService } from './build-worker.service';
import { WorkerBuildResultDto } from './dto/build.dto';

/**
 * The build dispatcher's API. Not for browsers: nginx does not route
 * `/api/internal/`, and the guard admits only the worker token.
 *
 * Throttling is skipped because the caller is one authenticated process that
 * polls by design; the per-user build throttle sits on the request route.
 */
@Controller('internal/build-jobs')
@UseGuards(BuildWorkerGuard)
@SkipThrottle()
export class BuildWorkerController {
  constructor(private readonly worker: BuildWorkerService) {}

  /** 200 with a job, or 204 when the queue is empty. */
  @Post('claim')
  async claim(@Res({ passthrough: true }) response: Response) {
    const job = await this.worker.claim();
    if (!job) {
      response.status(HttpStatus.NO_CONTENT);
      return;
    }
    return job;
  }

  @Post(':buildId/result')
  @HttpCode(HttpStatus.NO_CONTENT)
  async result(
    @Param('buildId', ParseUUIDPipe) buildId: string,
    @Body() body: WorkerBuildResultDto,
  ): Promise<void> {
    await this.worker.complete(buildId, body);
  }
}
