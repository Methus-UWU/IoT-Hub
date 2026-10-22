import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from './supabase-auth.guard';
import {
  LoginEventView,
  LoginHistoryRepository,
} from './login-history.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IP_LENGTH = 64;
const MAX_USER_AGENT_LENGTH = 512;
export const LOGIN_HISTORY_LIMIT = 50;

/**
 * Sign-in history: when, from which address, on which device.
 *
 * Supabase Auth performs the sign-in in the browser, so the API never sees it
 * happen. The client reports its session instead, and the row is keyed by the
 * session id from the verified token — a client can only ever record its own
 * real session, once. Address and device come from the request, not the body.
 */
@Injectable()
export class LoginHistoryService {
  constructor(private readonly history: LoginHistoryRepository) {}

  async record(
    user: AuthenticatedUser,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ): Promise<void> {
    // A token without a session id cannot be deduplicated; recording it on every
    // call would turn the history into a request log.
    if (!user.sessionId || !UUID.test(user.sessionId)) return;

    await this.history.record({
      userId: user.id,
      sessionId: user.sessionId,
      ipAddress: (ipAddress ?? '').slice(0, MAX_IP_LENGTH),
      userAgent: (userAgent ?? '').slice(0, MAX_USER_AGENT_LENGTH),
    });
  }

  list(userId: string): Promise<LoginEventView[]> {
    return this.history.listForUser(userId, LOGIN_HISTORY_LIMIT);
  }
}
