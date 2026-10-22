-- Defaults preserve existing Bangkok calendar windows. Table privileges and RLS stay intact.
ALTER TABLE public.ai_settings
  ADD COLUMN daily_reset_minute SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN weekly_reset_minute SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN weekly_reset_day SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN monthly_reset_minute SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN monthly_reset_day SMALLINT NOT NULL DEFAULT 1,
  ADD CONSTRAINT ai_settings_daily_reset_minute_check CHECK (daily_reset_minute BETWEEN 0 AND 1439),
  ADD CONSTRAINT ai_settings_weekly_reset_minute_check CHECK (weekly_reset_minute BETWEEN 0 AND 1439),
  ADD CONSTRAINT ai_settings_weekly_reset_day_check CHECK (weekly_reset_day BETWEEN 0 AND 6),
  ADD CONSTRAINT ai_settings_monthly_reset_minute_check CHECK (monthly_reset_minute BETWEEN 0 AND 1439),
  ADD CONSTRAINT ai_settings_monthly_reset_day_check CHECK (monthly_reset_day BETWEEN 1 AND 28);
