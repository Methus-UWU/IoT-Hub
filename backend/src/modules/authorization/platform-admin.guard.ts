import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/supabase-auth.guard';
import { AuthorizationService } from './authorization.service';

/**
 * Gates the admin console. Must be used after SupabaseAuthGuard, which establishes
 * the identity this guard resolves privileges for.
 *
 * The role is looked up in the database rather than read from the token, which is
 * what makes a demotion take effect immediately.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly authorization: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await this.authorization.requirePlatformAdmin(request.user.id);
    return true;
  }
}
