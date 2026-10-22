# Agent Work Pack

Task-oriented routing for an AI agent working on this repository. Start here, read
only what the task needs, then follow the pointers.

`AGENTS.md` at the repository root still holds the non-negotiable rules (language,
security, layering, definition of done). This directory holds *how to carry out a
work item*: what to read, what to produce, how to verify.

## Pick your route

| I am asked to… | Read, in order |
| --- | --- |
| Do the whole "make every page real" job | `PROMPT.md`, then this table row by row |
| Document or audit one page | `PAGE-INVENTORY.md`, `PAGE-BRIEF-TEMPLATE.md` |
| Make the AI generator pick devices, wire them, and write matching code | `AI-GENERATION.md`, `../ARCHITECTURE.md` § "Project-aware AI Assistant" |
| Change how a page looks | `UI-DESIGN.md`, `../CONVENTIONS.md` § "Shared UI" |
| Split a large file / remove duplicated logic | `WORKING-AGREEMENT.md`, `../CONVENTIONS.md` § "Refactoring" |
| Delete a file or a block that looks unused | `DEAD-CODE.md` — never delete before running that checklist |
| Add or change an HTTP endpoint | `../API.md`, `../CONVENTIONS.md` § "NestJS" |
| Touch auth, RLS, secrets, uploads, user code | `../SECURITY.md` |
| Touch schema, migrations, indexes, repositories | `../DATABASE.md`, skill `supabase-postgres-best-practices` |
| Understand why something is built this way | `../ARCHITECTURE.md`, `../adr/` |
| A command fails, a page 404s, a build breaks | `TROUBLESHOOTING.md` |

## Files in this pack

- `PROMPT.md` — the standing brief. Paste-ready for a fresh agent session.
- `WORKING-AGREEMENT.md` — engineering rules: library-first, lifecycle-first, no god
  files, how much to change per pass.
- `PAGE-INVENTORY.md` — every route, what backs it today, what is missing.
- `PAGE-BRIEF-TEMPLATE.md` — the shape of the per-page document you write.
- `AI-GENERATION.md` — the generator work order: device selection, wiring, code sync.
- `UI-DESIGN.md` — modern-minimal rules, tokens, the components you must reuse.
- `DEAD-CODE.md` — the "is this junk?" checklist.
- `TROUBLESHOOTING.md` — runbook of failures seen in this repo and their fixes.

## Rules for this pack itself

One subject per file. If a file passes roughly 200 lines, split it rather than
appending. Never restate what `docs/ARCHITECTURE.md`, `docs/API.md`,
`docs/DATABASE.md`, `docs/SECURITY.md`, or `docs/CONVENTIONS.md` already say — link
to the section instead. A fact belongs in exactly one file.
