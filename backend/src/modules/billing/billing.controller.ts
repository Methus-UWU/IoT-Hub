import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import {
  SupabaseAuthGuard,
  type AuthenticatedRequest,
} from '../auth/supabase-auth.guard';
import { EntitlementService } from './entitlement.service';

/**
 * Plan and usage for the signed-in user.
 *
 * Read-only. Changing a plan is not exposed here: an upgrade has payment
 * consequences and belongs to the billing flow, not to a profile endpoint.
 */
@Controller('me')
@UseGuards(SupabaseAuthGuard)
export class BillingController {
  constructor(private readonly entitlements: EntitlementService) {}

  /** Real counts from the user's own data. Never sample values. */
  @Get('usage')
  usage(@Req() request: AuthenticatedRequest) {
    return this.entitlements.usageReport(request.user.id);
  }
}
