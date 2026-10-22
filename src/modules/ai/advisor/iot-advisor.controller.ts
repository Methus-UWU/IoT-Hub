import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { THROTTLE_OVERRIDES } from '../../../common/config/security.config';
import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../../auth/supabase-auth.guard';
import { IotAdvisorChatDto } from './iot-advisor.dto';
import { IotAdvisorService } from './iot-advisor.service';

@Controller('ai/advisor')
@UseGuards(SupabaseAuthGuard)
export class IotAdvisorController {
  constructor(private readonly advisor: IotAdvisorService) {}

  @Throttle(THROTTLE_OVERRIDES.ai)
  @Post('chat')
  chat(
    @Req() request: AuthenticatedRequest,
    @Body() body: IotAdvisorChatDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    // A user who leaves stops paying for the rest of the generation.
    const controller = new AbortController();
    const cancel = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once('close', cancel);

    return this.advisor
      .chatFor(request.user.id, body, controller.signal)
      .finally(() => response.off('close', cancel));
  }
}
