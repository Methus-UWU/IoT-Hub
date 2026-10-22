# Dead Code — Check Before Deleting

Deleting is allowed and often correct. Deleting *without evidence* is not. Run this
checklist and record the result in the page brief or the pull request.

## Checklist

1. **Referenced anywhere?**
   ```bash
   grep -rn "SymbolOrFileName" frontend/src backend/src \
     --exclude-dir=generated --exclude-dir=node_modules
   ```
   Search the class name, the file base name, and the route path separately — a lazy
   route references a file by path string, so a class-name search alone misses it.

2. **Reachable from a route or a module?** Frontend: is it in `app.routes.ts`, or in
   a component that is? Backend: is it in a `@Module` `providers`/`controllers`
   array, and is that module imported by `app.module.ts`?

3. **Generated?** `backend/src/generated/prisma/**` and
   `projects/catalog/device-catalog.generated.ts` are outputs. Never edit or delete
   them by hand — change the source and regenerate.

4. **Named in documentation or an ADR?** If `docs/` describes it as current, the doc
   and the code must be resolved together, not silently diverged.

5. **Does a test cover it?** A spec referencing it means it is contract, not litter,
   until the contract is retired too.

6. **Git history.** `git log --oneline -- <path> | head` — something added last week
   is more likely unfinished than abandoned. Ask before removing it.

7. **Is it the only implementation of something the UI promises?** A service with no
   backend behind it is an *unfinished feature*, not dead code. Those are listed in
   `PAGE-INVENTORY.md` as Orphan and need a decision, not a `rm`.

## Verdicts

- **Delete** — unreferenced, unrouted, untested, undocumented, and older than the
  feature that replaced it. Delete the whole set: component, template, styles,
  service, model, route entry, and any now-unused import.
- **Keep, and say why** — referenced, generated, or covered by a spec. Add a comment
  only if the reason is non-obvious.
- **Escalate** — an orphan page or an endpoint with no caller. Ask the user whether
  to build it or drop it. Do not decide silently; a deleted admin page is invisible
  until someone needs it.

## Known candidates to evaluate (do not delete unchecked)

- `ServerMonitoringService`'s random-metric generator, if `/admin/server`,
  `/admin/dashboard`, and `/admin/logs` get a real backend or get dropped. It is
  shared by all three — evaluate the trio together.
- Legacy `/api/projects/:projectId/workspace/*` file routes. The editor moved to
  `project_files` (`ADR-004`), but the toolchain, serial monitor, and attached-device
  list still use these routes. Delete only the file operations, and only after
  confirming no caller remains.
- `features/user/documents/` if the route is dropped rather than backed.
- Anything `LEGACY_AUDIT.md` lists that no longer exists — fix the document instead.

## After deleting

Type-check both projects, run the tests, and load the app. Then update
`PAGE-INVENTORY.md` and any document that named what you removed.
