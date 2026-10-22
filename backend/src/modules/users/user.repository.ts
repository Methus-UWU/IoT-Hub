/**
 * Persistence contract for user profiles.
 *
 * Credentials are absent by design: Supabase Auth owns passwords, sessions, and
 * verification. `id` is the Supabase Auth user id, and the profile row is created
 * by a database trigger on sign-up rather than by this application.
 *
 * See docs/adr/ADR-001-database-access.md and ADR-003.
 */

/** The public shape of a user, safe to return from the API. */
export interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  email: string;
  isActive: boolean;
  role: { name: string };
}

/** A user as the admin console lists them. */
export interface AdminUserView {
  id: string;
  username: string;
  email: string;
  role: string;
  status: 'active' | 'suspended';
  createdAt: Date;
}

export interface UpdateAdminUserInput {
  username?: string;
  roleName?: string;
  isActive?: boolean;
}

export interface UpdateUserProfileInput {
  username: string;
  displayName?: string | null;
  bio?: string | null;
}

export abstract class UserRepository {
  abstract findProfileById(id: string): Promise<UserProfile | null>;

  /**
   * Uniqueness check during an update. Absent criteria are not searched for, so a
   * partial update does not accidentally match on an empty string.
   */
  abstract findOtherIdByUsernameOrEmail(
    excludedUserId: string,
    criteria: { username?: string; email?: string },
  ): Promise<string | null>;

  abstract existsByEmail(email: string): Promise<boolean>;

  abstract existsByUsername(username: string): Promise<boolean>;

  abstract updateProfile(
    id: string,
    input: UpdateUserProfileInput,
  ): Promise<UserProfile>;

  abstract count(): Promise<number>;

  abstract listForAdmin(): Promise<AdminUserView[]>;

  abstract exists(id: string): Promise<boolean>;

  abstract updateForAdmin(
    id: string,
    input: UpdateAdminUserInput,
  ): Promise<AdminUserView>;
}
