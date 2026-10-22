import { Service } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';

/**
 * Owns the single Supabase browser client.
 *
 * One instance matters: each client attaches its own storage listener and token
 * refresh timer, so creating several would race each other refreshing the same
 * session.
 *
 * The key held here is the publishable key. It carries no authority of its own —
 * Row Level Security decides what its bearer may read — which is why it is safe in
 * a bundle. The Supabase secret key must never reach this project.
 */
@Service()
export class SupabaseClientService {
  private cached: SupabaseClient | null = null;

  get isConfigured(): boolean {
    return Boolean(environment.supabaseUrl && environment.supabasePublishableKey);
  }

  get client(): SupabaseClient {
    if (!this.isConfigured) {
      throw new Error(
        'Supabase is not configured. Set supabaseUrl and supabasePublishableKey in src/environments.',
      );
    }

    this.cached ??= createClient(
      environment.supabaseUrl,
      environment.supabasePublishableKey,
      {
        auth: {
          // The session lives in browser storage and is restored on reload; the
          // client refreshes it before expiry without the app scheduling anything.
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
        },
      },
    );

    return this.cached;
  }
}
