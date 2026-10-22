import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { AuthenticatedRequest, SupabaseAuthGuard } from './supabase-auth.guard';

/** A request that may or may not carry an identity. */
export type MaybeAuthenticatedRequest = Omit<AuthenticatedRequest, 'user'> & {
  user?: AuthenticatedRequest['user'];
};

/**
 * Identity when it is offered, anonymous access when it is not.
 *
 * For endpoints the public may read but which say more to a signed-in reader —
 * the community feed, which marks how you voted. The two cases are deliberately
 * different:
 *
 *   - No Authorization header: the caller is a visitor. Allowed, no `user`.
 *   - A header that fails verification: rejected with 401, exactly as the strict
 *     guard would. Treating a stale token as anonymous would hide the user's own
 *     votes instead of letting the client refresh and retry.
 *
 * It grants nothing by itself; a handler must still check `request.user` before
 * doing anything that requires an account.
 */
@Injectable()
export class OptionalSupabaseAuthGuard implements CanActivate {
  constructor(private readonly strict: SupabaseAuthGuard) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<MaybeAuthenticatedRequest>();

    if (!request.get('authorization')) return true;

    return this.strict.canActivate(context);
  }
}
