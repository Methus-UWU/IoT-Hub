import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UserProfile, UserRepository } from '../users/user.repository';
import { CheckExistDto, UpdateProfileDto } from './dto';

/**
 * Profile operations for the authenticated user.
 *
 * This service no longer authenticates anybody. Registration, login, logout,
 * session refresh, email verification, password reset, and MFA all belong to
 * Supabase Auth; the platform keeps no password and issues no token. What remains
 * here is the application's own profile record, which Supabase does not own.
 */
@Injectable()
export class AuthService {
  constructor(private readonly users: UserRepository) {}

  /**
   * The profile row is created by the `on_auth_user_created` database trigger, so
   * its absence means the trigger did not run — a deployment fault, not a normal
   * state, and worth surfacing distinctly rather than as a generic 401.
   */
  async getMe(userId: string): Promise<UserProfile> {
    const user = await this.users.findProfileById(userId);

    if (!user) {
      throw new NotFoundException({
        code: 'PROFILE_NOT_FOUND',
        message: 'No profile exists for this account',
      });
    }

    return user;
  }

  async updateMe(userId: string, body: UpdateProfileDto): Promise<UserProfile> {
    const current = await this.getMe(userId);
    if (!current.isActive) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account is suspended',
      });
    }
    const username = body.username.trim();

    const duplicateId = await this.users.findOtherIdByUsernameOrEmail(userId, {
      username,
    });
    if (duplicateId) {
      throw new ConflictException({
        code: 'USERNAME_TAKEN',
        message: 'Username already exists',
      });
    }

    return this.users.updateProfile(userId, {
      username,
      ...(body.displayName !== undefined
        ? { displayName: body.displayName?.trim() || null }
        : {}),
      ...(body.bio !== undefined ? { bio: body.bio?.trim() || null } : {}),
    });
  }

  async checkExists(body: CheckExistDto): Promise<{ exists: boolean }> {
    const value = body.value.trim();
    const exists =
      body.field === 'email'
        ? await this.users.existsByEmail(value.toLowerCase())
        : await this.users.existsByUsername(value);

    return { exists };
  }
}
