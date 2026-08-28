import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SupabaseConfig } from '../../common/config/supabase.config';

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
