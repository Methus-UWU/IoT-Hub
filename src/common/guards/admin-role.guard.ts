import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import type { AccessTokenPayload } from '../../modules/auth/strategies/jwt.strategy';

type AuthenticatedRequest = Request & { user?: AccessTokenPayload };

@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.role.toLowerCase() !== 'admin') {
      throw new ForbiddenException('Admin role is required');
    }
    return true;
  }
}
