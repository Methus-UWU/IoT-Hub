import { Controller, Get, Header, UseGuards } from '@nestjs/common';

import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { PlatformAdminGuard } from '../authorization/platform-admin.guard';
import { AdminDatabaseService } from './admin-database.service';

@Controller('admin/database')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class AdminDatabaseController {
  constructor(private readonly database: AdminDatabaseService) {}

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  getOverview() {
    return this.database.getOverview();
  }
}
