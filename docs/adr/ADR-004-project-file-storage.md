# ADR-004: Where Project File Content Lives

- Status: Accepted
- Date: 2026-08-28
- Related: `docs/DATABASE.md`, `docs/ARCHITECTURE.md` (Phase 5), `docs/adr/ADR-001-database-access.md`

## Context

Project files lived on the API host at `.workspace-data/<userId>/<projectId>/`. That
had to end: files were unqueryable, unshareable, unbackupable, tied to a single API
instance, and their ownership was implied by a path segment rather than recorded.

The target stack names Supabase Storage, so the obvious move was to put file content
in a Storage bucket with metadata rows in PostgreSQL. `docs/DATABASE.md` even
suggests a `content_reference` field.

What these files actually are matters more than where the stack diagram puts them:

- Source text — `.ino`, `.cpp`, `.h`, `.py`, `platformio.ini`.
- Capped at 512 KB each, 500 per project, 8 MB per project in total.
- Written by an **autosaving editor**: small, frequent, concurrent writes.
- Read as a set when the IDE opens a project.

## Decision

**Source file content is a `TEXT` column on `project_files` in PostgreSQL.
Supabase Storage is reserved for build artifacts and binary assets, which arrive
with Phase 4.**

## Options Considered

### 1. Content in Supabase Storage, metadata in PostgreSQL

**For.** Uses the named component. Unbounded file sizes. Content does not occupy
database storage or appear in backups of it.

**Against — decisive.** A save becomes two writes to two systems with no shared
transaction. Every failure mode has to be handled by the application:

- Storage write succeeds, row update fails → the row points at stale content.
- Row update succeeds, Storage write fails → the row points at content that is not
  there.
- Deleting a file leaves an orphaned object unless a reconciliation job exists.

Optimistic concurrency also stops being a single atomic statement: the version check
and the content write land in different systems, so two editor tabs can interleave
in ways that a `WHERE version = ?` cannot prevent. For a feature whose entire point
is frequent concurrent saves, that is the wrong trade.

It is also slower for the common case: opening a project would mean one query plus
N object fetches, instead of one query.

### 2. Content in a PostgreSQL `TEXT` column — **chosen**

**For.** A save is one statement, so `UPDATE … WHERE version = ?` is genuinely
atomic and a stale write cannot land. No orphans, because deleting the row deletes
the content. Listing and reading a project is one query. Content is covered by the
same backup and the same RLS policies as its metadata. PostgreSQL keeps values over
~2 KB in TOAST storage out of line automatically, so rows stay small.

**Against.** Content occupies database storage, which is more expensive per byte
than object storage, and it is not suited to large or binary files. Both are bounded
by the quotas above: the worst case is 8 MB per project, and the realistic case is
tens of kilobytes.

### 3. Hybrid — small text inline, large or binary in Storage

**For.** Right answer at both ends of the range.

**Against.** Two code paths, two failure models, and a threshold to argue about, in
exchange for handling files this product does not have. The schema does not preclude
adding `content_reference` later, so this can be adopted if and when binary assets
appear — without migrating the text files.

## Consequences

- Autosave is atomic and safely versioned. `project_files` carries `version`, and
  the update is `updateMany` with the version in the `WHERE` clause, so the check and
  the write cannot be separated by another writer.
- A batch save reports per-file outcomes instead of failing wholesale, so one stale
  tab does not discard work in every other tab.
- Quotas are enforced in the service **and** as database `CHECK` constraints, so a
  bug in the service cannot write a row the database would have refused. This was
  verified against the live database: traversal, absolute paths, backslashes, double
  slashes, empty paths, leading-dot segments, oversize content, and duplicate paths
  are all rejected at the storage layer.
- `docs/DATABASE.md`'s `content_reference` field is not used for source files. It
  remains the right shape for artifacts.
- If projects ever hold large binary assets, revisit and adopt option 3 for those
  files specifically.

## Path safety

The path validation from the filesystem implementation was carried over **unchanged**
into `project-file-path.ts` — same segment allow-list, same depth limit, same
rejections. The legacy audit identified it as the strongest security code in the
repository, and a storage migration is exactly the kind of change that quietly
weakens such a check.

The only rule dropped is `assertInside`, which compared resolved filesystem paths and
has no meaning without a filesystem. Traversal is now rejected by the segment rules
alone, and the database repeats those rules as a `CHECK` constraint, so an unsafe
path cannot become an unsafe Storage object key when artifacts arrive.
