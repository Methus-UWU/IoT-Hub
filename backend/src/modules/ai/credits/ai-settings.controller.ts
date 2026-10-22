import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AiCreditsService } from '../../ai-credits/ai-credits.service';
import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../../auth/supabase-auth.guard';
import { PlatformAdminGuard } from '../../authorization/platform-admin.guard';
import { ModelCatalogService } from '../providers/model-catalog.service';
import { CreditOverrideDto, UpdateAiSettingsDto } from './dto/ai-settings.dto';

/**
 * The integrations page's AI controls: the assistants' primary and fallback models,
 * default credit limits per user, per-user overrides, and usage. Platform admins only;
 * the role is read from the database on every request.
 */
@Controller('admin/ai-settings')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class AdminAiSettingsController {
  constructor(
    private readonly credits: AiCreditsService,
    private readonly catalog: ModelCatalogService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get() {
    const [settings, catalog, latencyOrder] = await Promise.all([
      this.credits.settings(),
      this.catalog.load(),
      this.catalog.latencyOrder(),
    ]);
    return {
      ...settings,
      catalog: {
        stale: catalog.stale,
        fetchedAt: catalog.fetchedAt,
        latencyOrder,
        models: catalog.models
          .map((model) => ({
            id: model.id,
            name: model.name,
            vendor: model.vendor,
            isFree: model.isFree,
            supportsTools: model.supportsTools,
            contextLength: model.contextLength,
            promptPricePerMillion: model.promptPricePerMillion,
            completionPricePerMillion: model.completionPricePerMillion,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      },
    };
  }

  @Put()
  async update(
    @Req() request: AuthenticatedRequest,
    @Body() body: UpdateAiSettingsDto,
  ) {
    const chosen = [
      ...(body.primaryModel ? [body.primaryModel] : []),
      ...(body.fallbackModels ?? []),
    ];
    if (chosen.length) {
      const { models, stale } = await this.catalog.load();
      const known = new Set(models.map((model) => model.id));
      const unknown = chosen.filter((id) => !known.has(id));
      // A stale catalog may simply be missing a model; only a live one can refuse.
      if (unknown.length && !stale) {
        throw new BadRequestException({
          code: 'AI_MODEL_NOT_FOUND',
          message: `Not in the OpenRouter catalog: ${unknown.join(', ')}`,
        });
      }
    }
    if (body.primaryModel === null && body.fallbackModels?.length) {
      throw new BadRequestException({
        code: 'AI_PRIMARY_MODEL_REQUIRED',
        message: 'Choose a primary model before adding fallbacks',
      });
    }
    return this.credits.updateSettings(
      {
        ...(body.primaryModel !== undefined
          ? { primaryModel: body.primaryModel }
          : {}),
        ...(body.fallbackModels !== undefined
          ? {
              fallbackModels: [...new Set(body.fallbackModels)].filter(
                (id) => id !== body.primaryModel,
              ),
            }
          : {}),
        ...(body.defaults ? { defaults: body.defaults } : {}),
        ...(body.resets ? { resets: body.resets } : {}),
      },
      request.user.id,
    );
  }

  @Get('overrides')
  @Header('Cache-Control', 'no-store')
  overrides() {
    return this.credits.overrides();
  }

  @Put('overrides/:userId')
  setOverride(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: CreditOverrideDto,
  ) {
    return this.credits.setOverride(
      userId,
      {
        daily: body.daily ?? null,
        weekly: body.weekly ?? null,
        monthly: body.monthly ?? null,
      },
      body.note?.trim() ?? '',
    );
  }

  @Delete('overrides/:userId')
  @HttpCode(204)
  async deleteOverride(@Param('userId', ParseUUIDPipe) userId: string) {
    await this.credits.deleteOverride(userId);
  }

  @Get('usage')
  @Header('Cache-Control', 'no-store')
  usage() {
    return this.credits.summary();
  }

  /** One user's usage against their limits, for checking an override. */
  @Get('usage/:userId')
  @Header('Cache-Control', 'no-store')
  userUsage(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.credits.usageFor(userId);
  }
}

/** The caller's own AI credits: used and left this day, week, and month. */
@Controller('ai/credits')
@UseGuards(SupabaseAuthGuard)
export class AiCreditsController {
  constructor(private readonly credits: AiCreditsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  mine(@Req() request: AuthenticatedRequest) {
    return this.credits.usageFor(request.user.id);
  }
}
