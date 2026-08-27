import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { THROTTLE_OVERRIDES } from '../../common/config/security.config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../../common/guards/admin-role.guard';
import { AiService } from './ai.service';
import { AiChatDto } from './dto/ai-chat.dto';

@Controller('admin/ai')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('providers')
  getProviders() {
    return this.aiService.listProviders();
  }

  @Throttle(THROTTLE_OVERRIDES.ai)
  @Post('chat')
  chat(
    @Body() body: AiChatDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const controller = new AbortController();
    const cancelProviderRequest = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once('close', cancelProviderRequest);

    return this.aiService
      .chat(body, controller.signal)
      .finally(() => response.off('close', cancelProviderRequest));
  }
}
