# ADR-009: Admin-managed AI Models and Per-user Credits

- Status: **Accepted — implemented 2026-10-11**
- Date: 2026-10-11
- Related: ADR-007, ADR-008, `docs/API.md` § "AI models and credits"

## Context

Two things could only be changed through environment variables, or not at all:

- **Which models answer.** The assistants' models came from `AI_PROJECT_MODEL` and
  `AI_FALLBACK_MODEL`, so a change needed a redeploy.
- **How much each user may spend.** Nothing recorded or limited a user's AI use. The
  usage panel showed "AI CREDITS 0" because there was no data.

The operator asked for one admin page, `/admin/integrations`, to choose a primary and
fallback models, and to set each user's credits per day, week, and month.

## Decision

### Settings

`ai_settings` is a single row (`id = 1`) holding:

- `primary_model`;
- up to five ordered `fallback_models`;
- the default `daily`, `weekly`, and `monthly` credits, where -1 means unlimited.

When a primary model is set, the project assistant and the IoT advisor's OpenRouter
path send it first, followed by the fallbacks (OpenRouter `models` routing). The
advisor still tries Gemini first. When no primary is set, the old behaviour stays:
the `AI_PROJECT_MODEL` pins and the ranked catalog.

Choosing a model on this page is the operator's consent to pay for it, as an
environment pin already was, so paid models are allowed here even while
`AI_ALLOW_PAID_MODELS` is off. On save, every chosen id is checked against the live
OpenRouter catalog. A stale catalog cannot refuse a model.

### Credits

- Credits follow the work the AI did (changed on 2026-10-11 from one credit per
  message): `credits = max(1, ceil((input_tokens + 4 × output_tokens) / 2000))`.
  Output tokens weigh four times input, as providers price them, and a turn's tokens
  are summed over every round of its tool loop. A short question costs about 2–3
  credits and building a whole project 30–40. A failed request costs nothing.
- Periods follow Thailand time. Admins set the time for daily resets, the weekday
  and time for weekly resets, and the date (1–28) and time for monthly resets.
  Defaults remain midnight, Monday, and the 1st. The schedule applies to everyone,
  including per-user overrides, and recalculates windows from existing usage events.
  It does not delete history or need a scheduled reset job.
- `AiCreditsService.assertCanUse` runs before anything is stored or sent to a provider.
  Once any period's credits are spent, requests are refused with
  `429 AI_CREDIT_LIMIT_REACHED`, and the message reports the latest reset among all
  exhausted periods. A
  request's cost is known only after it is answered, so the last request before a
  limit may take the total past it.
- `ai_credit_overrides` replaces any of the three limits for one user. A NULL column
  keeps the default; -1 means unlimited.
- `ai_usage_events` records each answered request: the model, its token counts, and
  its credits. The admin page totals it and lists the heaviest users this month.
- The account usage panel's "AI CREDITS" now shows this month's credits against the
  monthly limit. That limit supersedes the plan limit `max_ai_requests`, which was
  never enforced.

### Placement

`AiCreditsModule` (`src/modules/ai-credits/`) depends only on Prisma, so both the AI
module, which enforces and records credits, and billing, which reports them, can import
it without a cycle. The admin routes live in the AI module because validating a model
needs the catalog.

## Consequences

- The admin picker uses the shared searchable select for primary models, fallbacks,
  and users. Price filtering (all/free/paid) and price/latency ordering only change
  discovery; they never clear a selected model or reorder configured fallbacks.
  Prices show input/output USD per million tokens and sort by their average, with
  unavailable prices last. Latency uses provider ordering, with unavailable ordering
  disabled; its limitations and cache behavior are documented in `docs/API.md`.
- Credit inputs remain visible and disabled for unlimited/inherited modes, without
  numeric steppers. Switching modes keeps the draft number; only explicit limits
  require an integer from 0 to 1,000,000. Wire values remain -1 and null respectively.
- The admin page keeps the token explanation short, with the formula and examples
  behind a native details control. Reset scheduling has its own save action, with
  validated Bangkok wall-clock inputs. `20261011040000_ai_credit_reset_schedule`
  must be applied before deploying the updated backend.

- Admins change models and limits without a redeploy. The settings cache refreshes
  every 15 seconds.
- Concurrent requests check the limit before either is recorded. Completed turns can
  exceed their preflight allowance by the tokens they consume; later requests wait
  for the exhausted periods to reset. A hard ceiling would need reservations.
- Credits count tokens, not money. If paid models are used heavily, a price weight per
  model can be multiplied in without a schema change.
