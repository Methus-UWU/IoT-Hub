/**
 * Persistence contract for refresh sessions.
 *
 * Refresh tokens are stored hashed, never in clear text, so the contract accepts
 * and returns a hash and leaves comparison to the caller. See
 * docs/adr/ADR-001-database-access.md.
 */

export interface SessionWithUser {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expireAt: Date;
  revokeAt: Date | null;
  user: {
    id: string;
    email: string;
    isActive: boolean;
    roleName: string;
  };
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  ip?: string;
  agentDevice?: string;
  refreshTokenHash: string;
  expireAt: Date;
}

export interface RotateSessionInput {
  ip?: string;
  agentDevice?: string;
  refreshTokenHash: string;
  expireAt: Date;
}

export abstract class SessionRepository {
  abstract create(input: CreateSessionInput): Promise<void>;

  abstract findByIdWithUser(id: string): Promise<SessionWithUser | null>;

  abstract rotate(id: string, input: RotateSessionInput): Promise<void>;

  abstract revoke(id: string): Promise<void>;

  abstract countActive(): Promise<number>;
}
