# Standing Brief — IoT Hub

Paste this as the opening message of a fresh agent session. Everything it needs
beyond this page is reachable through `docs/agent/README.md`.

---

You are working on IoT Hub: an Angular 22 frontend (`frontend/`) and a NestJS 11
backend (`backend/`) over Supabase PostgreSQL, Auth, and Storage.

## Your goal

Every page in the product must do the real thing it claims to do, against real
backend state — not against `Math.random()`, `localStorage`, or a hardcoded fixture.
The flagship case is the project workspace: the assistant must choose devices from
the catalog itself, wire them to real pins, and write firmware whose pin numbers
match the wires it just drew.

## How to work

1. **Read before writing.** Open `docs/agent/README.md`, find the row that matches
   your task, and read only the documents it points to. Do not scan the repository.
2. **One page or one concern per pass.** Finish it — code, docs, verification —
   before starting the next. A pass that leaves a page half-migrated is worse than
   not starting.
3. **Reuse before you write.** Search for an existing service, store, shared
   component, pipe, guard, or repository that already does it. Extend that.
4. **Framework and library before hand-rolled logic.** See
   `docs/agent/WORKING-AGREEMENT.md`. Writing 200 lines of scheduling, diffing,
   validation, or date maths that a dependency already ships is a defect, not effort.
5. **Keep logic where it belongs.** Angular: template renders, component wires
   events, store holds state, service talks HTTP. NestJS: controller handles HTTP,
   service holds business rules, repository touches the database, guard authorizes.
   No business logic in templates. No SQL in the frontend. No Prisma types in a
   service signature.
6. **Small coherent diffs.** No drive-by refactors of code you are not fixing.
7. **Verify before reporting.** Type-check, run the tests that cover what you
   touched, and load the page. Report what actually ran and what failed.

## Deliverables per work item

- The working code.
- One page brief under `docs/pages/` when you finish a page — use
  `docs/agent/PAGE-BRIEF-TEMPLATE.md`, one file per page, never one combined file.
- An update to `docs/agent/PAGE-INVENTORY.md` status column.
- A new entry in `docs/agent/TROUBLESHOOTING.md` for any non-obvious failure you
  hit and solved.
- An ADR in `docs/adr/` only when you made a decision that constrains future work.

## Hard limits

- Never expose a Supabase service-role key, database password, JWT, refresh token,
  or device secret. Frontend authorization is UX only; the backend decides.
- Never execute user code inside the NestJS process — isolated build workers only.
- Never delete a file or a code block without running the checklist in
  `docs/agent/DEAD-CODE.md` and quoting its result.
- Never add a dependency without the evaluation in `docs/CONVENTIONS.md` §
  "Dependencies". Free and self-hostable wins over anything that needs a paid key.
- Never invent an endpoint. If the frontend calls a route the backend does not
  serve, either build the route or delete the call — record which in the page brief.

## Where to communicate

Code, comments, filenames, schema, routes, and documentation in English. Explain
progress to the user in Thai.
