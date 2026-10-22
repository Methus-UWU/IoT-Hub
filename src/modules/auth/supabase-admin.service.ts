import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SupabaseConfig } from '../../common/config/supabase.config';
import { AVATAR_BUCKET, AVATAR_MAX_BYTES } from './avatar.constants';

/**
 * The only holder of the Supabase secret key in this process.
 *
 * That key bypasses RLS, so it is confined to this service, never logged, never
 * returned, and never placed in an environment passed to a child process. Every
 * privileged Supabase operation goes through a named method here rather than
 * through an ad-hoc client constructed at a call site.
 */
@Injectable()
export class SupabaseAdminService {
  private readonly logger = new Logger(SupabaseAdminService.name);
  private client?: SupabaseClient;

  constructor(private readonly config: SupabaseConfig) {}

  get isAvailable(): boolean {
    return this.config.canPerformAdminOperations;
  }

  /**
   * Suspension has two halves and both are needed. The profile flag stops this API
   * immediately, because authorization reads it per request. The Supabase ban stops
   * Supabase from refreshing the session or issuing a new one — without it the
   * user's current access token would remain valid at Storage and Realtime until it
   * expired.
   */
  async setBanned(userId: string, banned: boolean): Promise<void> {
    const client = this.requireClient();
    const { error } = await client.auth.admin.updateUserById(userId, {
      // Supabase treats 'none' as "not banned"; a long duration as indefinite.
      ban_duration: banned ? '876000h' : 'none',
    });

    if (error) {
      this.logger.error(
        `Failed to ${banned ? 'ban' : 'unban'} user ${userId}: ${error.message}`,
      );
      throw new ServiceUnavailableException({
        code: 'SUPABASE_ADMIN_FAILED',
        message: 'The identity provider rejected the account update',
      });
    }
  }

  /**
   * Creates a confirmed account. The `on_auth_user_created` trigger then creates
   * the profile and personal workspace exactly as it does for a self sign-up, with
   * the username taken from `user_name` metadata.
   */
  async createUser(input: {
    email: string;
    password: string;
    username: string;
  }): Promise<string> {
    const { data, error } = await this.requireClient().auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { user_name: input.username },
    });

    if (error || !data.user) {
      if (error?.code === 'email_exists' || error?.status === 422) {
        throw new ConflictException({
          code: 'EMAIL_TAKEN',
          message: 'An account with that email already exists',
        });
      }
      this.logger.error(`Failed to create identity user: ${error?.message}`);
      throw new ServiceUnavailableException({
        code: 'SUPABASE_ADMIN_FAILED',
        message: 'The identity provider rejected the new account',
      });
    }

    return data.user.id;
  }

  async deleteUser(userId: string): Promise<void> {
    const client = this.requireClient();
    const { error } = await client.auth.admin.deleteUser(userId);

    if (error) {
      this.logger.error(`Failed to delete user ${userId}: ${error.message}`);
      throw new ServiceUnavailableException({
        code: 'SUPABASE_ADMIN_FAILED',
        message: 'The identity provider rejected the account deletion',
      });
    }
  }

  async listUserLastSignIns(): Promise<ReadonlyMap<string, string | null>> {
    const client = this.requireClient();
    const lastSignIns = new Map<string, string | null>();
    let page = 1;

    while (page > 0) {
      const { data, error } = await client.auth.admin.listUsers({
        page,
        perPage: 1000,
      });

      if (error) {
        this.logger.error(
          `Failed to list identity users on page ${page}: ${error.message}`,
        );
        throw this.identityReadFailure();
      }

      for (const user of data.users) {
        lastSignIns.set(user.id, user.last_sign_in_at ?? null);
      }

      page = data.nextPage ?? 0;
    }

    return lastSignIns;
  }

  async getUserLastSignIn(userId: string): Promise<string | null> {
    const { data, error } =
      await this.requireClient().auth.admin.getUserById(userId);

    if (error) {
      this.logger.error(
        `Failed to read identity user ${userId}: ${error.message}`,
      );
      throw this.identityReadFailure();
    }

    return data.user.last_sign_in_at ?? null;
  }

  async readAvatar(userId: string): Promise<Buffer | null> {
    const { data, error } = await this.requireClient()
      .storage.from(AVATAR_BUCKET)
      .download(this.avatarPath(userId));
    if (error) {
      if (this.isMissingStorageObject(error)) return null;
      throw this.avatarStorageFailure();
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async saveAvatar(userId: string, png: Buffer): Promise<void> {
    const storage = this.requireClient().storage;
    let bucket = await storage.getBucket(AVATAR_BUCKET);
    if (bucket.error && this.isMissingStorageObject(bucket.error)) {
      // Provision once on the first upload. A competing request may create it first.
      await storage.createBucket(AVATAR_BUCKET, {
        public: false,
        fileSizeLimit: AVATAR_MAX_BYTES,
        allowedMimeTypes: ['image/png'],
      });
      bucket = await storage.getBucket(AVATAR_BUCKET);
    }
    if (bucket.error || !bucket.data || bucket.data.public) {
      throw this.avatarStorageFailure();
    }
    const { error } = await storage
      .from(AVATAR_BUCKET)
      .upload(this.avatarPath(userId), png, {
        contentType: 'image/png',
        cacheControl: '0',
        upsert: true,
      });
    if (error) throw this.avatarStorageFailure();
  }

  async removeAvatar(userId: string): Promise<void> {
    const { error } = await this.requireClient()
      .storage.from(AVATAR_BUCKET)
      .remove([this.avatarPath(userId)]);
    if (error && !this.isMissingStorageObject(error))
      throw this.avatarStorageFailure();
  }

  private avatarPath(userId: string): string {
    // The authenticated subject, never a client filename or requested owner.
    return `${encodeURIComponent(userId)}/avatar.png`;
  }

  private isMissingStorageObject(error: { message: string }): boolean {
    return /^(object|bucket) not found\.?$/i.test(error.message);
  }

  private avatarStorageFailure(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'AVATAR_STORAGE_UNAVAILABLE',
      message: 'Profile image storage is temporarily unavailable',
    });
  }

  private identityReadFailure(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'SUPABASE_ADMIN_FAILED',
      message: 'The identity provider could not return account activity',
    });
  }

  private requireClient(): SupabaseClient {
    if (!this.isAvailable) {
      throw new ServiceUnavailableException({
        code: 'SUPABASE_ADMIN_NOT_CONFIGURED',
        message:
          'Administrative identity operations require SUPABASE_SECRET_KEY to be configured',
      });
    }

    this.client ??= createClient(this.config.url, this.config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    return this.client;
  }
}
