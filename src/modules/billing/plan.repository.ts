import { PlanSummary } from './entitlement';

/**
 * Persistence contract for plans, subscriptions, and the counts limits are
 * measured against.
 *
 * Usage counts are repository methods because only the database can answer them
 * cheaply; computing them by loading rows into the service would turn every limit
 * check into a table scan.
 *
 * Component and connection counts arrive with the tables that hold them; adding
 * the methods before then would be contract for code that cannot exist yet.
 *
 * See docs/adr/ADR-001-database-access.md.
 */
export interface AccountUsage {
  projectCount: number;
  storageBytes: number;
}

export abstract class PlanRepository {
  /**
   * The plan a user is on. Returns null only when the subscription row is
   * missing, which the sign-up trigger makes impossible for a new account — the
   * caller treats that as a fault rather than as "no limits apply".
   */
  abstract findPlanForUser(userId: string): Promise<PlanSummary | null>;

  /** Projects and stored bytes across every workspace the user belongs to. */
  abstract usageForUser(userId: string): Promise<AccountUsage>;

  /** Total duration of the builds this user requested since `since`. */
  abstract buildMillisSince(userId: string, since: Date): Promise<number>;
}
