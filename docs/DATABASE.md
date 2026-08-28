# Database

## Primary Database

Use Supabase PostgreSQL.

Database structure must have one source of truth.

Use version-controlled migrations.

Do not manually modify production schema without a migration.

## ORM Strategy

The legacy system used Prisma.

Do not automatically preserve Prisma.

Evaluate:

* Supabase server SDK
* PostgreSQL driver/query builder
* Prisma

Document the selected approach in:

`docs/adr/ADR-001-database-access.md`

Prisma, if used, is backend-only.

## Schema Rules

Use constraints where appropriate:

* PRIMARY KEY
* FOREIGN KEY
* UNIQUE
* NOT NULL
* CHECK

Common resource fields may include:

* id
* created_at
* updated_at

Use revision/version only where optimistic concurrency is needed.

Do not automatically add soft deletion to every table.

## Workspace Model

Core relationship:

User
→ Workspace
→ Project
→ Device
→ Datastream
→ Dashboard

Workspace membership should be modeled explicitly.

Example roles:

* owner
* admin
* developer
* editor
* viewer

## Project Files

Do not store an entire project source tree as one large JSON document.

Use a structured project file model.

Example fields:

* id
* project_id
* path
* name
* content_reference
* content_hash
* size
* version
* created_at
* updated_at

Protect against:

* duplicate paths
* path traversal
* oversized files
* oversized projects

## Telemetry

PostgreSQL may initially store telemetry when traffic volume is manageable.

Typical fields:

* device_id
* timestamp
* metric
* value
* metadata

Common query index:

(device_id, timestamp)

Do not add indexes without query justification.

Keep telemetry access abstract enough to support future time-series storage.

## Query Rules

Avoid unbounded queries.

Avoid N+1 queries.

Avoid SELECT * when explicit contracts are preferable.

Use pagination.

Use cursor pagination for large collections when appropriate.

Use transactions for multi-step operations requiring atomicity.

## RLS

Use RLS for exposed sensitive resources.

Test policies for:

* ownership
* workspace membership
* viewer/editor roles
* private projects
* admin access

Every important RLS rule should have a corresponding security test.

---

# Implemented Decisions

## ORM strategy

Resolved in `docs/adr/ADR-001-database-access.md`: **Prisma, backend-only**, with
Prisma Migrate as the single migration source of truth.

Rules that follow from that decision:

1. `prisma/schema.prisma` plus its migration history is the only schema source.
   The Supabase CLI must not be used to author `public` schema changes.
2. RLS policies, functions, and triggers are hand-written SQL inside Prisma
   migration files. A migration that adds a table needing a policy adds the policy
   in the same migration.
3. **Prisma must be scoped to the `public` schema.** Supabase owns `auth`, `storage`,
   and `realtime`. A `prisma migrate` run that can see those schemas will propose
   dropping them. This is the single most dangerous operational risk in the ORM
   decision — verify the scoping before the first migration against Supabase.
4. Prisma is backend-only and never reaches Angular.

## Repository layer

No business service touches Prisma. Services depend on abstract repository classes;
the Prisma implementations are bound in one module each:

| Contract | Implementation | Bound in |
| --- | --- | --- |
| `UserRepository` | `PrismaUserRepository` | `modules/users/users.module.ts` |
| `RoleRepository` | `PrismaRoleRepository` | `modules/users/users.module.ts` |
| `SessionRepository` | `PrismaSessionRepository` | `modules/auth/auth.module.ts` |

Repositories are domain-oriented, never `GenericRepository<T>`. An operation that
must be atomic is one repository method, so the transaction stays inside the
persistence layer — `UserRepository.changePassword` and
`UserRepository.updateForAdmin` both revoke sessions in the same transaction as the
write they accompany.

Changing the database technology means writing new implementations of those three
classes and editing the `useClass` bindings. No service, controller, or test changes.

## Current schema

Three tables — `roles`, `users`, `sessions` — from migration
`20260715082240_add_auth`. The workspace, project, device, datastream, and dashboard
model described above is not implemented yet; it arrives with Phase 2.

Known schema issues to address in the Phase 2 migration:

- `sessions.refresh_token` is `UNIQUE` on a bcrypt hash. Salting makes the
  constraint meaningless and it costs an index. Drop it additively.
- Expired and revoked sessions are never purged. Needs a retention job.
- No `updated_at` on `sessions`.

## Applied to Supabase (2026-08-28)

Three migrations applied to the Supabase Cloud project via the session pooler
(port 5432 — the transaction pooler on 6543 cannot run Prisma migrations).

Verified after applying:

- RLS enabled on `users`, `workspaces`, `workspace_members`, `roles`, with 8 policies.
- Triggers live on `auth.users`: `on_auth_user_created`, `on_auth_user_email_changed`.
- `users.id → auth.users.id` foreign key present, `users.password` gone.
- Roles `admin` and `user` seeded.
- Sign-up trigger tested end to end inside a rolled-back transaction: profile and
  personal workspace created with the member as `owner`, username derived from OAuth
  metadata, email change mirrored onto the profile.

### Defect found and fixed during that test

`workspaces.owner_id` was `ON DELETE RESTRICT` while `users.id` cascaded from
`auth.users`. Because the sign-up trigger gives every user a personal workspace,
**deleting any account failed** — from the API, the Supabase admin API, and the
dashboard alike.

Cascading workspaces would have been worse: a shared workspace would have been
destroyed along with its owner, taking other members' work with it.

Migration `20260828010000_workspace_owner_succession` adds a `BEFORE DELETE` trigger
on `public.users` that settles ownership first — handing each owned workspace to its
most senior remaining member, or deleting it when there is none. The `RESTRICT`
constraint stays as a safety net that should now never fire.

Both paths are covered by the rolled-back verification: a sole-member workspace is
removed with its owner; a shared workspace survives and its editor is promoted to
owner.
