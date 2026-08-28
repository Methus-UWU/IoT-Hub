# ADR-003: Supabase Auth Adoption and Existing Account Migration

- Status: **Accepted** (decided 2026-08-28 by the platform owner; implemented)
- Date: 2026-08-28
- Related: `docs/SECURITY.md`, `docs/ARCHITECTURE.md` (Phase 3), `docs/LEGACY_AUDIT.md` (Q2, Q7)

## Context

The platform authenticates with a custom JWT implementation over a local `users`
table. `docs/ARCHITECTURE.md` targets Supabase Auth, which supplies the capabilities
the current system lacks entirely: email verification, password reset, MFA, and
provider sign-in.

The current implementation is not careless — it rotates refresh tokens, stores them
hashed, revokes explicitly, and revokes sibling sessions on password change. Those
guarantees must survive the migration. What it lacks is everything around them.

### What the live database actually contains

Read-only inspection on 2026-08-28 of the database named by `DATABASE_URL`:

- 3 users: `admin1`, `user1`, `admin3`.
- 2 roles: `admin`, `user`.
- 50 session rows, 6 of them currently active.

**This is not clean seed data.** The removed seed file created `admin1`, `user1`, and
`user2`. The live database has `admin3` and no `user2`, so at least one account was
created outside seeding and at least one seeded account was removed. The data set
cannot be assumed disposable, which is precisely the situation that requires a
decision rather than a guess.

`admin1` and `user1` were most likely created by the old seed and therefore still
carry the password that was hardcoded in tracked source. `admin1` is an
administrator. Their credentials must be changed regardless of which migration
option is chosen.

## Decisions Required

### D1. Hosting model — DECIDED: Supabase Cloud

Supabase Cloud or self-hosted Supabase. This affects cost, RLS operations,
connection pooling behaviour (PgBouncer transaction mode breaks prepared
statements), where build workers run, and who holds the service-role key. No
Supabase project exists yet — the current database is plain PostgreSQL with only
`public`, and none of Supabase's `auth`, `storage`, or `realtime` schemas.

### D2. Existing account migration — DECIDED: Option C, start clean

| Option | Description | Consequence |
| --- | --- | --- |
| **A. Import and force reset** | Copy the three accounts into `auth.users`, invalidate their passwords, require a reset email. | Preserves identity, ownership, and history. Every user must reset once. Requires working outbound email before cutover. |
| **B. Dual-run** | Both systems accept logins during a transition window; on successful legacy login, transparently create the Supabase account. | No user-visible disruption. Explicitly contradicts `docs/SECURITY.md`'s "do not maintain a second application password database", so it must be time-boxed and documented if chosen. |
| **C. Start clean** | Treat the three accounts as disposable, recreate them in Supabase Auth. | Simplest by far, and defensible given three accounts. Only safe if `admin3` belongs to nobody who would lose access, which the repository cannot determine. |

**Recommendation: A**, unless the owner confirms that all three accounts are
throwaway, in which case C. bcrypt hashes can in principle be imported into
`auth.users.encrypted_password`, but doing so would carry the leaked password
forward for `admin1` and `user1`, so a forced reset is the right call either way.

### D3. Role and membership model at cutover — DECIDED: both, see below

The current model is one `role_id` per user with two roles. The target is workspace
membership with `owner | admin | developer | editor | viewer`. Whether the platform
`admin` role survives as a global role alongside workspace roles, or becomes a claim
on a system workspace, is a modelling decision worth making before the schema lands
rather than after.

## Proposed Design (once decisions are made)

Authentication moves to Supabase Auth; authorization stays in NestJS.

- **Authentication.** Supabase Auth issues and refreshes sessions. NestJS verifies
  the Supabase JWT in a `SupabaseAuthGuard` replacing `JwtStrategy`. The
  `sessions` table, `users.password`, and all token issuance in `AuthService` are
  deleted — not kept alongside.
- **Authorization.** A single policy layer, not role string comparisons scattered
  across controllers. `AdminRoleGuard` reads the role **from the database**, closing
  the current gap where a demotion takes up to 15 minutes to take effect because the
  role is trusted from a JWT claim.
- **Ownership.** `workspace_members` becomes the ownership boundary, replacing
  today's "the user id is a path segment" isolation.
- **Entitlement.** A separate centralized model, so `if (plan === 'pro')` never
  appears in a feature.
- **RLS.** Defence in depth on the NestJS path per ADR-001, and a hard boundary for
  Supabase Storage and Realtime accessed directly from Angular.
- **Frontend.** Route guards stay UX only. The existing single-flight refresh in
  `authInterceptor` is preserved; only its token source changes.

### Required security tests before cutover

Per the workspace authorization model in the migration brief:

1. User A cannot read or modify User B's private workspace or project.
2. A `viewer` cannot modify a protected resource.
3. An unauthenticated request cannot reach a protected resource.
4. A removed member immediately loses access.
5. RLS rejects unauthorized access on the paths where it applies.

## Consequences

- Removes audit findings A1, A2, A4, A5, A6, A7, A9 and S11 in one step.
- Deletes the Turnstile stub or makes it real: the token is currently accepted and
  never verified, so the CAPTCHA is decorative and rate limiting is the only
  brute-force control.
- Introduces a hard dependency on Supabase availability for login.
- Requires working outbound email before verification or reset can be enabled.

## Status

Blocked. Phase 3 cannot start until D1 and D2 are answered, because both change what
the schema and the cutover script must do, and getting them wrong risks locking a
real administrator out of a live system.

---

# Decision Record (2026-08-28)

The platform owner answered the open questions:

- **D1 — Hosting: Supabase Cloud.** A project already exists; `SUPABASE_URL` is set
  in the backend environment.
- **D2 — Accounts: start clean (Option C).** The three accounts in the legacy local
  database are throwaway test users created to reach the admin console. They are not
  migrated. The legacy PostgreSQL database is left untouched rather than deleted, so
  the decision remains reversible.
- **D3 — Roles: both models coexist.** The platform `admin` role on `users.role_id`
  continues to gate the admin console. Workspace membership governs everything a
  user owns. They answer different questions and are evaluated by the same service.
- **Sign-in methods: email/password, Google, and GitHub.**

## As Implemented

| Concern | Owner |
| --- | --- |
| Registration, login, logout, session refresh | Supabase Auth, called directly from Angular |
| Email verification, password reset, MFA | Supabase Auth |
| OAuth with Google and GitHub | Supabase Auth (PKCE), returning to `/auth/callback` |
| Token verification | NestJS `SupabaseAuthGuard`, via the project JWKS |
| Platform and workspace authorization | NestJS `AuthorizationService`, resolved from the database |
| Profile record, roles, workspaces | `public` schema, owned by this application |

### Key design points

**No signing secret in the API.** Tokens are verified against the project's
published JWKS rather than a shared secret, so leaking the API's configuration
cannot be used to mint a token. `jose` caches and rotates the key set.

**The guard grants nothing.** `SupabaseAuthGuard` establishes identity and reads no
role. A forged `role` claim in a token is ignored, and there is a test for exactly
that. Every privilege comes from `AuthorizationService`, which reads the database on
each call — so a demotion or suspension takes effect on the next request rather than
at the next token refresh, closing audit finding S11.

**Not-a-member and does-not-exist are the same answer.** `requireWorkspaceRole`
raises 404 in both cases, so error codes cannot be used to enumerate workspace ids.

**Profiles are created by the database, not the application.** The
`on_auth_user_created` trigger creates the profile row and a personal workspace in
the same transaction as the `auth.users` insert, whichever provider was used. A
half-initialised account is therefore not a state the application has to repair.

**Suspension is applied in both systems, banning first.** The profile flag stops
this API immediately; the Supabase ban stops the session being refreshed and blocks
Storage and Realtime. Ban first, so a Supabase failure cannot leave a suspension
half-applied in the permissive direction.

**Password change re-authenticates.** Supabase's `updateUser()` accepts a new
password on the strength of the session alone, which would let a hijacked session
take over an account silently. The client re-signs in with the current password
first. Accounts created through Google or GitHub have no password to verify and are
directed to the reset flow.

**Cloudflare Turnstile was removed, not preserved.** Its token was sent to the API
and never verified, and sign-in no longer passes through the API at all. Bot
protection belongs in Supabase under Authentication → Attack Protection, where it is
enforced. Leaving the widget in place would have implied a control that did not
exist.

**No cookie handling remains.** The refresh cookie, `cookie-parser`, and the
`ALLOW_INSECURE_COOKIES` switch are gone with the tokens they carried, which also
retires audit findings S12 and S13.
