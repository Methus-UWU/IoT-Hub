import { Controller, Get, UseGuards } from '@nestjs/common';

import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CREATABLE_BOARD_DEFINITIONS } from './board-catalog';

/**
 * Boards a project can be created with.
 *
 * Product catalog, not workspace data, so it lives at the root rather than under a
 * workspace. Served from the backend so the create dialog and the validation that
 * rejects an unknown board agree on one list instead of each keeping its own.
 */
@Controller('boards')
@UseGuards(SupabaseAuthGuard)
export class BoardsController {
  @Get()
  list() {
    return CREATABLE_BOARD_DEFINITIONS;
  }
}
