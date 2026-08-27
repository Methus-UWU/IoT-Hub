# ADR-001: Database Access Strategy

- Status: Accepted
- Date: 2026-08-28
- Deciders: platform team
- Supersedes: none
- Related: `docs/DATABASE.md`, `docs/ARCHITECTURE.md`, `docs/LEGACY_AUDIT.md` (Q1)

## Context

The platform is migrating to Supabase PostgreSQL. `docs/DATABASE.md` requires one
schema source of truth, version-controlled migrations, and RLS on exposed sensitive
tables. `AGENTS.md` permits Prisma only if the architecture explicitly chooses it,
and forbids maintaining conflicting Prisma, Supabase, and manual SQL schemas.

What the repository actually contains today:

- Prisma 7 with the `@prisma/adapter-pg` driver adapter and the read-replicas
  extension, wrapped in a global `PrismaService`.
- Three models — `Role`, `User`, `Session` — and one migration.
- Five services calling `this.prisma.db.*` directly. No repository layer.
- Two transactions, both "update a user and revoke sessions atomically".
- No Supabase project provisioned yet, and no Supabase code anywhere.

The decision is therefore made against a small, well-understood surface: roughly
twenty query sites across three tables. That matters more than any abstract
comparison, because it means the cost of being wrong is low **provided** the query
code is not scattered through the domain services — which is the other half of
Phase 1.

## Decision

**Keep Prisma as the backend-only ORM. Keep Prisma Migrate as the single migration
source of truth. Author RLS policies, functions, and triggers as raw SQL inside
Prisma migration files. Place every query behind a domain-oriented repository so
that no business service depends on a Prisma API.**

## Options Considered

### 1. Supabase server SDK (`@supabase/supabase-js`) as the primary data path

**For.** Native fit with the rest of Supabase. When called with the end user's JWT
it enforces RLS automatically, which makes RLS a real boundary rather than a
second-guess. No separate migration tool: the Supabase CLI owns SQL migrations,
which is also where policies must live anyway.

**Against.** The data path is PostgREST, not SQL. Multi-table reads become nested
`select()` strings that are neither type-checked nor composable, aggregates are
awkward, and there is no general transaction primitive — multi-step atomic work has
to move into a Postgres function. This repository has two such transactions today
and will have more once workspaces, projects, and billing arrive. Typing is
generated from the database and is considerably weaker than Prisma's for anything
beyond single-table access.

The decisive point: using the service-role key from NestJS bypasses RLS anyway, so
the main advantage of the SDK on the server evaporates in the architecture we are
actually building, where NestJS is the authorization authority.

### 2. Prisma, backend-only — **chosen**

**For.** Already working, already understood, zero migration cost for existing code.
Strong generated types with no codegen step of our own. First-class transactions.
Prisma migrations are plain SQL files, so RLS policies and functions can be added to
them by hand, keeping one migration history rather than two. Prisma is documented as
supported against Supabase, and the `pg` driver adapter already in use handles the
pooler.

**Against.** `schema.prisma` cannot express RLS policies, so policy SQL lives in
migration files rather than in the schema — the schema is the source of truth for
tables, the migration history is the source of truth for policies. Prisma connects
as a privileged role, so RLS does not constrain the NestJS data path unless we
explicitly set the request's claims per transaction. Prisma must be scoped to
`public` so it never proposes changes to Supabase's `auth` and `storage` schemas.

### 3. Kysely, or `pg` with hand-written SQL

**For.** Full PostgreSQL surface, excellent type safety, trivially compatible with
RLS and `SET LOCAL`, and no opinion about migrations.

**Against.** Every existing query must be rewritten, and a types-from-database
codegen step must be introduced, in exchange for capabilities this repository does
not currently need. It also leaves migrations unsolved — we would still have to
adopt a second tool for them.

## Comparison

| Criterion | Supabase SDK | Prisma (chosen) | Kysely / raw SQL |
| --- | --- | --- | --- |
| Supabase compatibility | Native | Supported, needs `public` scoping | Native |
| Full PostgreSQL feature access | Limited by PostgREST | Good; raw SQL escape hatch | Complete |
| RLS on the NestJS path | Automatic with a user JWT, bypassed with the service key | Requires explicit per-transaction claims | Requires explicit per-transaction claims |
| Migrations | Supabase CLI | Prisma Migrate (SQL files) | Bring your own |
| Transactions | Postgres functions only | First class | First class |
| Type safety | Weak beyond single tables | Strong, generated | Strong, generated |
| Testing | Needs a live Supabase | Repositories mock cleanly | Repositories mock cleanly |
| Cost to migrate from today's code | Rewrite everything | None | Rewrite everything |

## Consequences

### Positive

- No rewrite, so Phase 1 spends its budget on the repository seam rather than on
  re-expressing queries that already work.
- One migration history. Tables come from `schema.prisma`; policies, functions, and
  triggers are hand-written SQL inside the same migration files.
- Transactions stay ordinary code.
- Repositories are mockable, so authorization and ownership tests do not need a
  database.

### Negative

- RLS is genuinely defence in depth on the NestJS path, not the primary control.
  NestJS remains the authorization authority, exactly as `docs/SECURITY.md` states.
  RLS becomes a hard boundary for the paths that do use a user JWT — Supabase
  Storage and Realtime accessed directly from Angular.
- Policy SQL is not visible in `schema.prisma`. Mitigation: every migration that
  adds a table that needs a policy adds the policy in the same migration, and
  `docs/DATABASE.md` records the rule.
- Prisma must be pinned to the `public` schema so `prisma migrate` never proposes
  dropping Supabase-managed objects. **This is the single most dangerous operational
  risk in this decision** and is called out in `docs/DATABASE.md`.

### Reversal path

The repository layer introduced alongside this ADR is what makes the decision cheap
to revisit. Business services depend on `UserRepository`, `RoleRepository`, and
`SessionRepository` — abstract classes with no Prisma types in their signatures.
Swapping to Kysely or the Supabase SDK means writing new implementations of those
classes and rebinding them in a module, with no change to any service, controller,
or test.

Revisit this ADR if any of the following becomes true:

1. RLS needs to constrain the NestJS data path itself, not just direct client access.
2. Prisma Migrate conflicts with Supabase-managed schemas in practice.
3. Query complexity outgrows Prisma's query API often enough that `$queryRaw` becomes
   the norm rather than the exception.

## Compliance

- One schema source of truth: `prisma/schema.prisma` plus its migration history.
- No second competing schema: the Supabase CLI will not be used to author `public`
  schema changes.
- Prisma is backend-only and never reaches Angular.
- No business service imports `PrismaService` after its module is migrated.
