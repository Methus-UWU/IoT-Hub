import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

import {
  getRequestId,
  type RequestWithId,
} from '../../common/http/request-id.middleware';
import { AdminRequestLogStore } from './admin-request-log.store';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logs: AdminRequestLogStore) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const startedAt = performance.now();

    return next.handle().pipe(
      tap({
        next: () => this.record(request, response.statusCode, startedAt),
        error: (error: unknown) =>
          this.record(
            request,
            error instanceof HttpException ? error.getStatus() : 500,
            startedAt,
          ),
      }),
    );
  }

  private record(
    request: Request,
    statusCode: number,
    startedAt: number,
  ): void {
    this.logs.record({
      method: request.method,
      // Express path excludes the query string, which may contain secrets or OAuth codes.
      endpoint: request.path,
      statusCode,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      requestId: getRequestId(request as RequestWithId),
    });
  }
}
