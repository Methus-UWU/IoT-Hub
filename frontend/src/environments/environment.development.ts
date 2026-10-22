/**
 * Development configuration.
 *
 * Fill `supabaseUrl` and `supabasePublishableKey` from your Supabase project
 * (Project Settings > API). Left empty, the app reports that Supabase is not
 * configured instead of signing in.
 *
 * `supabasePublishableKey` is safe to ship in the bundle: it grants no authority by
 * itself, and Row Level Security decides what its bearer may read. The Supabase
 * secret key must NEVER appear here — it bypasses RLS and belongs only to the API.
 */
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api/',
  supabaseUrl: '', // https://<project-ref>.supabase.co
  supabasePublishableKey: '', // sb_publishable_...
};
