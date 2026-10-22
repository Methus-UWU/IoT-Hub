import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { THROTTLE_OVERRIDES } from '../../common/config/security.config';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { PlatformAdminGuard } from '../authorization/platform-admin.guard';
import { AiService } from './ai.service';
import { AiChatDto } from './dto/ai-chat.dto';

@Controller('admin/ai')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /** Task profiles plus the live OpenRouter catalog grouped by vendor. */
  @Get('catalog')
  getCatalog() {
    return this.aiService.listCatalog();
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
