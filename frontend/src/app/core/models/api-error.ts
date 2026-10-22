import { HttpErrorResponse } from '@angular/common/http';

/**
 * Reads the API's error envelope, `{ error: { code, message } }`
 * (`backend/src/common/filters/all-exceptions.filter.ts`).
 */
function envelope(error: unknown): { code?: unknown; message?: unknown } | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const body = error.error as { error?: { code?: unknown; message?: unknown } } | null;
  return body && typeof body === 'object' && body.error ? body.error : null;
}

/** The server's own message for the user, when it sent one. */
export function apiErrorMessage(error: unknown): string | null {
  const message = envelope(error)?.message;
  return typeof message === 'string' && message ? message : null;
}

export function apiErrorCode(error: unknown): string | null {
  const code = envelope(error)?.code;
  return typeof code === 'string' ? code : null;
}
