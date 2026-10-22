# Page Brief Template

One file per page, written to `docs/pages/<route-slug>.md` when you finish that page.
Never combine pages into one document — the point is that a later agent loads exactly
one page's worth of context.

Keep it under roughly 80 lines. Facts that belong to the whole system go in the
shared documents and are linked, not copied.

---

```markdown
# <Route> — <Page name>

- Route: `/user/projects/:id/dashboard`
- Files: `frontend/src/app/features/.../`
- Backend: `backend/src/modules/...` (or "none")
- Status: Real | Partial | Simulated | Orphan
- Last verified: YYYY-MM-DD

## What the user can do here

Three to six bullets, in the user's terms, not the code's.

## How it works

The data path in one paragraph: which store holds the state, which service calls
which endpoint, which table it lands in. Name files as `path:line` where a reader
would otherwise have to search.

## What is not real yet

Anything faked, unsaved, or unreachable. Be specific — "layout is saved to
localStorage only" beats "persistence incomplete".

## Decisions made here

Only decisions that constrain future work, with the reason. If it constrains the
whole system, write an ADR instead and link it.

## Verification

The exact commands run and what was observed. Include failures.

## Follow-ups

Numbered, each small enough to be one pass. Delete the ones you complete.
```
