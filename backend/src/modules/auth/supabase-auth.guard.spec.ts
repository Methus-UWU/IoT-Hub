import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { SupabaseConfig } from '../../common/config/supabase.config';
import { SupabaseAuthGuard } from './supabase-auth.guard';

const PROJECT_URL = 'https://project.supabase.co';
const ISSUER = `${PROJECT_URL}/auth/v1`;

function configWith(values: Record<string, string>): SupabaseConfig {
  return new SupabaseConfig({
    get: (key: string) => values[key],
  } as unknown as ConfigService);
}

function contextFor(headers: Record<string, string>): {
  context: ExecutionContext;
  request: { user?: { id: string; email: string; sessionId?: string } };
} {
  const request: {
    user?: { id: string; email: string; sessionId?: string };
    get: (name: string) => string | undefined;
  } = {
    get: (name: string) => headers[name.toLowerCase()],
  };

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('SupabaseAuthGuard', () => {
  let privateKey: CryptoKey;
  let publicJwk: JWK;
  let attackerPrivateKey: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    privateKey = pair.privateKey;
    publicJwk = {
      ...(await exportJWK(pair.publicKey)),
      alg: 'ES256',
      kid: 'test',
    };

    const attacker = await generateKeyPair('ES256', { extractable: true });
    attackerPrivateKey = attacker.privateKey;
  });

  beforeEach(() => {
    // The guard fetches the project's JWKS over HTTP; serve the test key instead of
    // reaching the network.
    globalThis.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  function guard(): SupabaseAuthGuard {
    return new SupabaseAuthGuard(configWith({ SUPABASE_URL: PROJECT_URL }));
  }

  async function token(
    claims: Record<string, unknown>,
    signer: CryptoKey = privateKey,
    overrides: { issuer?: string; audience?: string; expires?: string } = {},
  ): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setIssuedAt()
      .setIssuer(overrides.issuer ?? ISSUER)
      .setAudience(overrides.audience ?? 'authenticated')
      .setExpirationTime(overrides.expires ?? '1h')
      .sign(signer);
  }

  it('rejects a request with no Authorization header', async () => {
    const { context } = contextFor({});

    await expect(guard().canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a non-bearer scheme', async () => {
    const { context } = contextFor({ authorization: 'Basic abc123' });

    await expect(guard().canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token signed by someone else', async () => {
    const forged = await token({ sub: 'user-1' }, attackerPrivateKey);
    const { context } = contextFor({ authorization: `Bearer ${forged}` });

    await expect(guard().canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const expired = await token({ sub: 'user-1' }, privateKey, {
      expires: '-1s',
    });
    const { context } = contextFor({ authorization: `Bearer ${expired}` });

    await expect(guard().canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token issued by another project', async () => {
    const foreign = await token({ sub: 'user-1' }, privateKey, {
      issuer: 'https://someone-else.supabase.co/auth/v1',
    });
    const { context } = contextFor({ authorization: `Bearer ${foreign}` });

    await expect(guard().canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token minted for a different audience', async () => {
    const wrongAudience = await token({ sub: 'user-1' }, privateKey, {
      audience: 'service_role',
    });
    const { context } = contextFor({
      authorization: `Bearer ${wrongAudience}`,
    });

    await expect(guard().canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an anonymous Supabase session', async () => {
    const anonymous = await token({ sub: 'user-1', is_anonymous: true });
    const { context } = contextFor({ authorization: `Bearer ${anonymous}` });

    await expect(guard().canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a valid token and exposes only identity', async () => {
    const valid = await token({
      sub: 'user-1',
      email: 'user@example.com',
      session_id: 'session-9',
      // A forged role claim must not become a privilege: the guard ignores it.
      role: 'admin',
    });
    const { context, request } = contextFor({
      authorization: `Bearer ${valid}`,
    });

    await expect(guard().canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      email: 'user@example.com',
      sessionId: 'session-9',
    });
    expect(request.user).not.toHaveProperty('role');
  });

  it('fails closed when Supabase is not configured', async () => {
    const unconfigured = new SupabaseAuthGuard(configWith({}));
    const valid = await token({ sub: 'user-1' });
    const { context } = contextFor({ authorization: `Bearer ${valid}` });

    await expect(unconfigured.canActivate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('answers 503, not 401, when the key set cannot be fetched', async () => {
    // A 401 here would sign the user out over a network fault; the token may be fine.
    globalThis.fetch = jest.fn(() =>
      Promise.reject(new TypeError('fetch failed')),
    );
    const valid = await token({ sub: 'user-1' });
    const { context } = contextFor({ authorization: `Bearer ${valid}` });

    await expect(guard().canActivate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
