import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

import { buildWorkerToken } from './build-worker.config';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Admits only the build dispatcher.
 *
 * With no token configured the routes do not exist (404), rather than existing
 * and refusing everyone. The comparison runs over fixed-length digests so its
 * timing does not reveal how much of a guess was right.
 */
@Injectable()
export class BuildWorkerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = buildWorkerToken();
    if (!expected) throw new NotFoundException();

    const header = context.switchToHttp().getRequest<Request>()
      .headers.authorization;
    const presented = header?.startsWith('Bearer ') ? header.slice(7) : '';

    if (!presented || !timingSafeEqual(digest(presented), digest(expected))) {
      throw new UnauthorizedException({
        code: 'INVALID_WORKER_TOKEN',
        message: 'Build worker credentials are invalid',
      });
    }
    return true;
  }
}
