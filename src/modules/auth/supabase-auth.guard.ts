import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';

import { SupabaseConfig } from '../../common/config/supabase.config';

/** The authenticated principal, derived only from a verified Supabase token. */
export interface AuthenticatedUser {
  /** Supabase Auth user id. Same value as `public.users.id`. */
  id: string;
  email: string;
  /** Supabase session id, used to scope "keep this session" operations. */
  sessionId?: string;
}

export type AuthenticatedRequest = Request & { user: AuthenticatedUser };

interface SupabaseTokenPayload extends JWTPayload {
  email?: string;
  session_id?: string;
  role?: string;
  is_anonymous?: boolean;
}

/**
 * Verifies a Supabase-issued access token.
 *
 * Verification uses the project's published JWKS, so this process never holds a
 * signing secret — a leak of the API's configuration cannot be used to mint tokens.
 * `jose` caches and rotates the key set itself.
 *
 * The guard establishes identity only. It deliberately reads no role and grants no
 * capability: authorization is the policy layer's job and is resolved from the
 * database, so a privilege change takes effect immediately rather than at the next
 * token refresh.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: SupabaseConfig) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.canVerifyTokens) {
      // Fails closed: an unconfigured deployment rejects everything rather than
      // waving requests through.
      throw new ServiceUnavailableException({
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Authentication is not configured on this server',
      });
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedException('Missing access token');

    const payload = await this.verify(token);

    if (!payload.sub) throw new UnauthorizedException('Invalid access token');
    // An anonymous Supabase session is not a user of this platform.
    if (payload.is_anonymous) {
      throw new UnauthorizedException('Anonymous sessions are not permitted');
    }

    request.user = {
      id: payload.sub,
      email: payload.email ?? '',
      sessionId: payload.session_id,
    };

    return true;
  }

  private async verify(token: string): Promise<SupabaseTokenPayload> {
    this.jwks ??= createRemoteJWKSet(new URL(this.config.jwksUrl));

    try {
      const { payload } = await jwtVerify<SupabaseTokenPayload>(
        token,
        this.jwks,
        {
          issuer: this.config.issuer,
          audience: 'authenticated',
        },
      );
      return payload;
    } catch (error) {
      // Failing to reach the key set says nothing about the token. Answering 401
      // would tell the client its session is gone, and the client signs the user
      // out; 503 still refuses the request but lets the client retry.
      if (isKeySetUnavailable(error)) {
        throw new ServiceUnavailableException({
          code: 'AUTH_KEYS_UNAVAILABLE',
          message: 'Token verification is temporarily unavailable',
        });
      }
      // The reason is deliberately not surfaced: expired, malformed, and
      // wrong-signature must be indistinguishable to a caller.
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}

/**
 * A JWKS fetch that timed out or never completed. Every verdict about the token
 * itself — expired, bad signature, unknown key id — is a JOSEError other than a
 * timeout; a failed `fetch` surfaces as a plain error instead.
 */
function isKeySetUnavailable(error: unknown): boolean {
  if (error instanceof errors.JWKSTimeout) return true;
  return !(error instanceof errors.JOSEError);
}

function bearerToken(request: Request): string | null {
  const header = request.get('authorization');
  if (!header) return null;

  const [scheme, value] = header.split(' ');
  if (!value || scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}
