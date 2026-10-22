import { Controller, Get, Header, UseGuards } from '@nestjs/common';

import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { PlatformAdminGuard } from '../authorization/platform-admin.guard';
import { AdminIntegrationsService } from './admin-integrations.service';

@Controller('admin/integrations')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class AdminIntegrationsController {
  constructor(private readonly integrations: AdminIntegrationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.integrations.list();
  }
}
