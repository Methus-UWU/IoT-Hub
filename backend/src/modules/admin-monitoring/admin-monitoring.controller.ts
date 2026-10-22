import { Controller, Get, Header, UseGuards } from '@nestjs/common';

import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { PlatformAdminGuard } from '../authorization/platform-admin.guard';
import { AdminMonitoringService } from './admin-monitoring.service';

@Controller('admin/monitoring')
@UseGuards(SupabaseAuthGuard, PlatformAdminGuard)
export class AdminMonitoringController {
  constructor(private readonly monitoring: AdminMonitoringService) {}

  @Get('snapshot')
  @Header('Cache-Control', 'no-store')
  getSnapshot() {
    return this.monitoring.getSnapshot();
  }
}
