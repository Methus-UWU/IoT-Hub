import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../auth/supabase-auth.guard';
import { RecordSearchDto, SearchScopeQueryDto } from './dto/search-history.dto';
import { SearchHistoryService } from './search-history.service';

@Controller('me/search-history')
@UseGuards(SupabaseAuthGuard)
export class SearchHistoryController {
  constructor(private readonly history: SearchHistoryService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: SearchScopeQueryDto,
  ) {
    return this.history.list(request.user.id, query.scope);
  }

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async record(
    @Req() request: AuthenticatedRequest,
    @Body() body: RecordSearchDto,
  ): Promise<void> {
    await this.history.record(request.user.id, body.scope, body.query);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(
    @Req() request: AuthenticatedRequest,
    @Query() query: SearchScopeQueryDto,
  ): Promise<void> {
    await this.history.clear(request.user.id, query.scope);
  }
}
