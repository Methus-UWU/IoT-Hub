import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Configuration boundary for Supabase.
 *
 * Two classes of credential, and the distinction is a security boundary:
 *
 * - **Publishable key** (`sb_publishable_…`, formerly the anon key). Safe in a
 *   browser bundle. It carries no authority of its own; RLS decides what the
 *   bearer may read. Angular holds this one.
 * - **Secret key** (`sb_secret_…`, formerly the service-role key). Bypasses RLS
 *   entirely. It must never reach Angular, never be logged, and never be handed to
 *   a build worker. Only this process holds it.
 *
 * Reading these through one injectable rather than `process.env` scattered across
 * services means there is a single place to audit for that mistake.
 */
@Injectable()
export class SupabaseConfig implements OnModuleInit {
  private readonly logger = new Logger(SupabaseConfig.name);

  constructor(private readonly config: ConfigService) {}

  /** Project URL, e.g. https://<ref>.supabase.co. Not secret. */
  get url(): string {
    return this.config.get<string>('SUPABASE_URL')?.trim() ?? '';
  }

  /** Browser-safe key. Not secret, but still read from configuration. */
  get publishableKey(): string {
    return (
      this.config.get<string>('SUPABASE_PUBLISHABLE_KEY')?.trim() ??
      this.config.get<string>('SUPABASE_ANON_KEY')?.trim() ??
      ''
    );
  }

  /**
   * RLS-bypassing key. Never return this to a client, never log it, never place
   * it in an environment handed to a child process.
   */
  get secretKey(): string {
    return (
      this.config.get<string>('SUPABASE_SECRET_KEY')?.trim() ??
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY')?.trim() ??
      ''
    );
  }

  /** Where NestJS fetches the public keys used to verify Supabase access tokens. */
  get jwksUrl(): string {
    return `${this.url.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  }

  /** Supabase signs project tokens with this issuer. */
  get issuer(): string {
    return `${this.url.replace(/\/$/, '')}/auth/v1`;
  }

  get isConfigured(): boolean {
    return this.url.length > 0;
  }

  get canVerifyTokens(): boolean {
    return this.isConfigured;
  }

  get canPerformAdminOperations(): boolean {
    return this.isConfigured && this.secretKey.length > 0;
  }

  /**
   * Reports what is missing at boot rather than failing on the first request.
   * Logs key *names* only — never a value, not even a prefix.
   */
  onModuleInit(): void {
    if (!this.isConfigured) {
      this.logger.warn(
        'SUPABASE_URL is not set. Supabase authentication is unavailable.',
      );
      return;
    }

    if (!this.publishableKey) {
      this.logger.warn(
        'SUPABASE_PUBLISHABLE_KEY is not set. The frontend cannot start a session.',
      );
    }

    if (!this.secretKey) {
      this.logger.warn(
        'SUPABASE_SECRET_KEY is not set. Admin operations against Supabase are unavailable.',
      );
    }
  }
}
