import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { REQUEST_ID_HEADER } from '../config/security.config';

export type RequestWithId = Request & { requestId?: string };

/**
 * Correlates a client-visible error response with server logs.
 *
 * An inbound header is accepted only when it looks like an identifier we issued;
 * anything else is replaced, so a caller cannot inject log-forging content or
 * collide with another request's identifier.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const inbound = request.get(REQUEST_ID_HEADER);
    const requestId =
      inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();

    request.requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}

export function getRequestId(request: RequestWithId): string {
  return request.requestId ?? 'unknown';
}
