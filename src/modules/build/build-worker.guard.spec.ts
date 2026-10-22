import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { BuildWorkerGuard } from './build-worker.guard';

const TOKEN = 'worker-token-0123456789abcdef0123456789';

function contextWith(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

describe('BuildWorkerGuard', () => {
  const guard = new BuildWorkerGuard();

  afterEach(() => {
    delete process.env.BUILD_WORKER_TOKEN;
  });

  it('hides the routes when no token is configured', () => {
    expect(() => guard.canActivate(contextWith(`Bearer ${TOKEN}`))).toThrow(
      NotFoundException,
    );
  });

  it('stays disabled with a token too short to be a secret', () => {
    process.env.BUILD_WORKER_TOKEN = 'short';

    expect(() => guard.canActivate(contextWith('Bearer short'))).toThrow(
      NotFoundException,
    );
  });

  it('admits the configured token', () => {
    process.env.BUILD_WORKER_TOKEN = TOKEN;

    expect(guard.canActivate(contextWith(`Bearer ${TOKEN}`))).toBe(true);
  });

  it.each([
    undefined,
    '',
    TOKEN,
    `Bearer ${TOKEN}x`,
    'Bearer ',
    `Basic ${TOKEN}`,
  ])('refuses %p', (header) => {
    process.env.BUILD_WORKER_TOKEN = TOKEN;

    expect(() => guard.canActivate(contextWith(header))).toThrow(
      UnauthorizedException,
    );
  });
});
