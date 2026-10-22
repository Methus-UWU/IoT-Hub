-- AI model settings and per-user credit limits, managed by admins.
--
-- Until now the assistants' primary and fallback models came only from environment
-- variables (AI_PROJECT_MODEL, AI_FALLBACK_MODEL), and nothing recorded or limited how
-- much each user used the AI. Three tables, all additive. No existing table or column
-- changes.
--
--   ai_settings          one row: primary and fallback models, default credit limits
--   ai_credit_overrides  per-user limits that replace the defaults
--   ai_usage_events      one row per answered AI request, with the credits it cost
--
-- The seeded row keeps today's behaviour: no models chosen (the environment pins
-- stay in force) and unlimited credits (-1).

-- ---------------------------------------------------------------------------
-- 1. Settings (a single row)
-- ---------------------------------------------------------------------------

CREATE TABLE "ai_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "primary_model" TEXT,
    "fallback_models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "daily_credits" INTEGER NOT NULL DEFAULT -1,
    "weekly_credits" INTEGER NOT NULL DEFAULT -1,
    "monthly_credits" INTEGER NOT NULL DEFAULT -1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ai_settings"
  ADD CONSTRAINT "ai_settings_single_row_check" CHECK ("id" = 1);

ALTER TABLE "ai_settings"
  ADD CONSTRAINT "ai_settings_models_check"
  CHECK (
    ("primary_model" IS NULL OR char_length("primary_model") BETWEEN 1 AND 160)
    AND coalesce(cardinality("fallback_models"), 0) <= 5
  );

ALTER TABLE "ai_settings"
  ADD CONSTRAINT "ai_settings_credits_check"
  CHECK ("daily_credits" >= -1 AND "weekly_credits" >= -1 AND "monthly_credits" >= -1);

INSERT INTO "ai_settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP);

-- ---------------------------------------------------------------------------
-- 2. Per-user overrides
-- ---------------------------------------------------------------------------

CREATE TABLE "ai_credit_overrides" (
    "daily_credits" INTEGER,
    "weekly_credits" INTEGER,
    "monthly_credits" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "ai_credit_overrides_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "ai_credit_overrides"
  ADD CONSTRAINT "ai_credit_overrides_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NULL keeps the default; -1 is unlimited.
ALTER TABLE "ai_credit_overrides"
  ADD CONSTRAINT "ai_credit_overrides_credits_check"
  CHECK (
    coalesce("daily_credits", 0) >= -1
    AND coalesce("weekly_credits", 0) >= -1
    AND coalesce("monthly_credits", 0) >= -1
    AND char_length("note") <= 200
  );

-- ---------------------------------------------------------------------------
-- 3. Usage ledger
-- ---------------------------------------------------------------------------

CREATE TABLE "ai_usage_events" (
    "id" BIGSERIAL NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 1,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_usage_events_user_id_created_at_idx"
  ON "ai_usage_events" ("user_id", "created_at" DESC);
CREATE INDEX "ai_usage_events_created_at_idx" ON "ai_usage_events" ("created_at");

ALTER TABLE "ai_usage_events"
  ADD CONSTRAINT "ai_usage_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_usage_events"
  ADD CONSTRAINT "ai_usage_events_check"
  CHECK (
    "feature" IN ('project', 'advisor')
    AND "credits" >= 0
    AND char_length("model") <= 160
  );

-- ---------------------------------------------------------------------------
-- 4. Row Level Security — defence in depth; NestJS stays the authority.
-- ---------------------------------------------------------------------------

ALTER TABLE "ai_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_credit_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage_events" ENABLE ROW LEVEL SECURITY;

-- A user may read their own usage; settings and overrides are admin data, read and
-- written only through the API.
CREATE POLICY "ai_usage_events_select_own" ON "ai_usage_events"
  FOR SELECT TO authenticated
  USING ("user_id" = auth.uid());

REVOKE ALL ON TABLE "ai_settings" FROM anon, authenticated;
REVOKE ALL ON TABLE "ai_credit_overrides" FROM anon, authenticated;
REVOKE ALL ON TABLE "ai_usage_events" FROM anon, authenticated;
REVOKE ALL ON SEQUENCE "ai_usage_events_id_seq" FROM anon, authenticated;
GRANT SELECT ON TABLE "ai_usage_events" TO authenticated;
