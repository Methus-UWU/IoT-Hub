import { Global, Module } from '@nestjs/common';

import { SupabaseConfig } from './supabase.config';

/**
 * Supabase configuration is global because the auth guard, the storage layer, and
 * the admin operations all need it, and because having exactly one provider makes
 * it possible to assert in a test that the secret key is read nowhere else.
 */
@Global()
@Module({
  providers: [SupabaseConfig],
  exports: [SupabaseConfig],
})
export class SupabaseModule {}
