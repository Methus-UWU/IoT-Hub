/** One sign-in as the account owner and administrators see it. */
export interface LoginEventView {
  id: string;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
}

export interface RecordLoginInput {
  userId: string;
  sessionId: string;
  ipAddress: string;
  userAgent: string;
}

export abstract class LoginHistoryRepository {
  /**
   * Records the session's sign-in. A session already recorded is left untouched,
   * so reporting the same session again is a no-op rather than an error.
   */
  abstract record(input: RecordLoginInput): Promise<void>;

  /** Newest first, at most `limit` rows. */
  abstract listForUser(
    userId: string,
    limit: number,
  ): Promise<LoginEventView[]>;
}
