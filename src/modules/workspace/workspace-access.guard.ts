import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

import type { AccessTokenPayload } from '../auth/strategies/jwt.strategy';

type WorkspaceRequest = Request & { user?: AccessTokenPayload };

@Injectable()
export class WorkspaceAccessGuard extends AuthGuard('jwt') {
  constructor(private readonly config: ConfigService) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const allowDevelopmentAccess =
      this.config.get<string>('NODE_ENV') !== 'production' &&
      this.config.get<string>('WORKSPACE_ALLOW_ANONYMOUS', 'true') === 'true';

    if (allowDevelopmentAccess) {
      const request = context.switchToHttp().getRequest<WorkspaceRequest>();
      request.user = {
        sub: 'development-user',
        email: 'development@localhost',
        role: 'user',
        type: 'access',
      };
      return true;
    }

    return super.canActivate(context);
  }
}
