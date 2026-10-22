/**
 * The address a user's most recent sign-in came from, as Supabase Auth recorded
 * it on the session it created.
 */
export abstract class SignInIpRepository {
  /** Keyed by user id; users without a matching session are absent. */
  abstract listLatest(): Promise<ReadonlyMap<string, string>>;

  abstract findLatest(userId: string): Promise<string | null>;
}
