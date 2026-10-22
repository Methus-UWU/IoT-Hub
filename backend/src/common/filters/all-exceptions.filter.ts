import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

import { isProduction } from '../config/security.config';
import {
  getRequestId,
  type RequestWithId,
} from '../http/request-id.middleware';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
    debug?: unknown;
    /** Extra context authored on a domain error, such as a limit and its usage. */
    [key: string]: unknown;
  };
}

const STATUS_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.BAD_GATEWAY]: 'BAD_GATEWAY',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

const GENERIC_MESSAGE = 'An unexpected error occurred';

/** Plain number so status comparisons do not mix a number with the HttpStatus enum. */
const SERVER_ERROR_THRESHOLD = 500;

/** Handled explicitly above; everything else on a domain payload is forwarded. */
const RESERVED_ERROR_KEYS = new Set([
  'code',
  'message',
  'statusCode',
  'error',
  'requestId',
  'details',
  'debug',
]);

/**
 * Central mapping from thrown errors to the `{ error: { code, message, requestId } }`
 * contract in docs/API.md.
 *
 * Security boundary: only an explicitly thrown HttpException reaches the client with
 * its own message. Everything else — driver errors, filesystem errors, programming
 * mistakes — is logged server-side and answered with a generic 500, so stack traces,
 * SQL text, paths, and configuration values never leave the process.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const requestId = getRequestId(context.getRequest<RequestWithId>());

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = this.fromHttpException(exception, status, requestId);

      if (status >= SERVER_ERROR_THRESHOLD) {
        this.logger.error(
          `[${requestId}] ${exception.message}`,
          exception.stack,
        );
      }

      response.status(status).json(body);
      return;
    }

    // Unknown failure: the detail stays in the log, the client gets a correlation id.
    this.logger.error(
      `[${requestId}] Unhandled exception`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: GENERIC_MESSAGE,
        requestId,
        ...(isProduction()
          ? {}
          : {
              debug:
                exception instanceof Error
                  ? exception.message
                  : String(exception),
            }),
      },
    } satisfies ApiErrorBody);
  }

  private fromHttpException(
    exception: HttpException,
    status: number,
    requestId: string,
  ): ApiErrorBody {
    const payload: unknown = exception.getResponse();
    const record =
      payload !== null && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : null;

    const code =
      (typeof record?.['code'] === 'string' ? record['code'] : undefined) ??
      STATUS_CODES[status] ??
      'ERROR';

    // ValidationPipe reports an array of constraint messages. They describe the
    // caller's own payload, so returning them leaks nothing about the server.
    const rawMessage = record?.['message'];
    const details = Array.isArray(rawMessage) ? rawMessage : undefined;
    const message =
      typeof rawMessage === 'string'
        ? rawMessage
        : typeof payload === 'string'
          ? payload
          : exception.message;

    // A domain error may carry context the client needs to act on — the ceiling
    // and current usage behind a limit refusal, for example. Those fields are
    // authored by us on the thrown payload, never derived from an exception, so
    // forwarding them leaks nothing. Server errors are excluded: their payload is
    // not something we constructed for the client.
    const context =
      record && status < SERVER_ERROR_THRESHOLD
        ? Object.fromEntries(
            Object.entries(record).filter(
              ([key]) => !RESERVED_ERROR_KEYS.has(key),
            ),
          )
        : {};

    return {
      error: {
        code,
        message: status >= SERVER_ERROR_THRESHOLD ? GENERIC_MESSAGE : message,
        requestId,
        ...(details ? { details } : {}),
        ...context,
      },
    };
  }
}
