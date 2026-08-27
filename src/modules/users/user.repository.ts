/**
 * Persistence contract for users.
 *
 * Business services depend on this abstract class, never on Prisma. Methods are
 * domain operations rather than generic CRUD, so an operation that must be atomic
 * — such as changing a password and revoking the other sessions — is expressed as
 * one method and the transaction stays inside the implementation.
 *
 * See docs/adr/ADR-001-database-access.md.
 */

/** The account identity needed to authenticate a login attempt. */
export interface UserCredentials {
  id: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
  roleName: string;
}

/** The public shape of a user, safe to return from the API. */
export interface UserProfile {
  id: string;
  username: string;
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
  lastLoginAt: Date | null;
}

export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
  roleId: string;
}

export interface UpdateAdminUserInput {
  username?: string;
  email?: string;
  roleName?: string;
  isActive?: boolean;
  passwordHash?: string;
}

export abstract class UserRepository {
  abstract findCredentialsByEmail(
    email: string,
  ): Promise<UserCredentials | null>;

  abstract findProfileById(id: string): Promise<UserProfile | null>;

  abstract findIdByUsernameOrEmail(
    username: string,
    email: string,
  ): Promise<string | null>;

  /**
   * Uniqueness check during an update: finds another account already using either
   * value. Absent criteria are not searched for, so a partial update does not
   * accidentally match on an empty string.
   */
  abstract findOtherIdByUsernameOrEmail(
    excludedUserId: string,
    criteria: { username?: string; email?: string },
  ): Promise<string | null>;

  abstract existsByEmail(email: string): Promise<boolean>;

  abstract existsByUsername(username: string): Promise<boolean>;

  abstract create(input: CreateUserInput): Promise<void>;

  abstract updateProfile(
    id: string,
    input: { username: string; email: string },
  ): Promise<UserProfile>;

  abstract findPasswordHashById(id: string): Promise<string | null>;

  /**
   * Atomic: the new password and the revocation of every other session commit
   * together, so a leaked session can never outlive the password that protected it.
   */
  abstract changePassword(
    id: string,
    passwordHash: string,
    keepSessionId: string | undefined,
  ): Promise<void>;

  abstract count(): Promise<number>;

  abstract listForAdmin(): Promise<AdminUserView[]>;

  abstract exists(id: string): Promise<boolean>;

  /**
   * Atomic: suspending an account or resetting its password revokes that user's
   * sessions in the same transaction as the update.
   */
  abstract updateForAdmin(
    id: string,
    input: UpdateAdminUserInput,
  ): Promise<AdminUserView>;
}
