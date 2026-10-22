# Working Agreement

How to build here. `docs/CONVENTIONS.md` says what the code should look like; this
says how to decide what to write in the first place.

## 1. Library and framework before hand-written logic

Before writing an algorithm, check whether something already installed does it.

| Need | Use | Do not write |
| --- | --- | --- |
| Async state, cancellation, retry, debounce | RxJS operators + `takeUntilDestroyed` | Manual subscription bookkeeping, `setTimeout` retry loops |
| Component teardown | `DestroyRef`, `takeUntilDestroyed`, `effect` cleanup | `ngOnDestroy` with a bag of booleans |
| Reactive local state | Signals, `computed`, `linkedSignal`, `resource` | Manual change detection nudges, duplicated derived fields |
| Route data and lazy loading | Router `loadComponent`, resolvers, route `data` | Fetching in `ngOnInit` then guarding with `if (!id) return` |
| Forms and validation | Reactive Forms + validators | Per-field `touched` booleans and manual error strings |
| Markdown | `marked` | A regex renderer |
| Code editing | `monaco-editor` | A textarea with custom highlighting |
| Styling | Tailwind 4 utilities + tokens in `styles.css` | Ad-hoc per-component colour literals |
| Request/response plumbing | HTTP interceptors, Nest Guards, Pipes, Interceptors, Filters | Repeating auth or error handling in every method |
| DTO validation | `class-validator` / `class-transformer` | Hand-written `if (typeof x !== 'string')` |
| Rate limiting, headers | `@nestjs/throttler`, `helmet` | Custom counters |
| Config | `@nestjs/config` + typed config files | `process.env` reads scattered through services |
| Database access | Prisma through a repository interface | Raw SQL in a service, Prisma types in a controller |
| JWT / JWKS | `jose`, Supabase Auth | Hand-rolled token parsing |

If nothing installed covers it, say so in one line and then write the smallest
version that solves *this* case. Do not build a framework.

## 2. Adding a dependency

Follow `docs/CONVENTIONS.md` § "Dependencies". Additionally: it must be free to use
in production, actively maintained, and must not require a hosted paid service. State
in the pull request what it replaces and how many lines it removed.

## 3. Where logic lives

Angular
- Template: rendering and event binding only. No computation, no `?.` chains three
  levels deep hiding a missing model.
- Component: view state and event handling. Under ~300 lines. Over that, split a
  child component or move the state to a store.
- Store (`*.store.ts`): signals, derived state, orchestration of service calls.
- Service (`*.service.ts`): HTTP and pure domain transforms. No DOM.
- `shared/`: only genuinely generic UI. Two similar-looking components are not
  automatically one component.

NestJS
- Controller: routing, DTO binding, response shape. No business rules.
- Service: business rules. Depends on repository interfaces, not Prisma.
- Repository: the only place that touches Prisma or SQL.
- Guard / policy: authorization. Every project-scoped route resolves workspace
  membership before it trusts an id from the request.

## 4. File size and splitting

These files are already over budget and are the standing refactor targets:

| File | Lines | Split into |
| --- | --- | --- |
| `frontend/.../virtual-device/virtual-device.page.ts` | ~2630 | canvas interaction, selection/inspector state, wiring interaction, persistence — the page keeps composition only |
| `frontend/.../workspace/project-workspace.page.ts` | ~1600 | file tree, editor host, build/serial panel, AI panel |
| `frontend/.../dashboard-builder/dashboard-builder.page.ts` | ~1110 | layout engine binding, widget CRUD, persistence |

Split only the page you are already working on. Extract behaviour into a service or
child component with its own file; do not move code into a `helpers.ts` grab bag.

## 5. Duplication

When you find the same behaviour a third time, extract it. Twice is a coincidence.
Extract the smallest useful abstraction, migrate the callers you can see, and leave
the rest alone if migrating them would widen the diff beyond the task.

## 6. Token and effort discipline

- Read the section of a document you need, not the whole document.
- Use `grep`/`glob` to locate before you open a file.
- Prefer editing an existing file over writing a new one.
- Do not paste large file contents back to the user; reference `path:line`.
- Do not re-derive facts already established in the session.

## 7. Skills to invoke

| Situation | Skill |
| --- | --- |
| Any Supabase work — Auth, Storage, RLS, client libraries, MCP, debugging | `supabase` |
| Schema, migration, index, RLS policy, slow query, `EXPLAIN` | `supabase-postgres-best-practices` |
| Reviewing your own diff before reporting | `code-review` |
| Reuse/simplification cleanup pass | `simplify` |
| Security-sensitive change on the branch | `security-review` |
| Charts, dashboards, any data visualisation | `dataviz` |
| Running or screenshotting the app to prove a change works | `run` |

## 8. Definition of done

`AGENTS.md` § "Definition of Done" applies unchanged. On top of it: the page has a
brief in `docs/pages/`, `PAGE-INVENTORY.md` reflects the new status, and no route in
the frontend calls an endpoint the backend does not serve.
