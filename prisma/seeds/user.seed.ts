/**
 * User seeding was removed with the move to Supabase Auth.
 *
 * Accounts are created by signing up through Supabase — email/password, Google, or
 * GitHub — and the `on_auth_user_created` database trigger creates the matching
 * profile row and a personal workspace. Creating a profile here would produce a row
 * with no corresponding `auth.users` entry, which the foreign key now rejects.
 *
 * To grant the platform admin role to the first account, sign up normally and then
 * run:
 *
 *   UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'admin')
 *   WHERE email = '<your address>';
 */
export function seedUsers(): Promise<void> {
  console.log(
    'ℹ Users are managed by Supabase Auth — nothing to seed. See prisma/seeds/user.seed.ts.',
  );
  return Promise.resolve();
}
