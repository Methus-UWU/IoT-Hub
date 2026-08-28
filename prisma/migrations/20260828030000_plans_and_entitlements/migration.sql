-- Plans and entitlements.
--
-- The backend is the source of truth for resource limits: the frontend may display
-- them, but it must never be what enforces them. Limits are rows rather than
-- constants in code, so adjusting a plan is a data change, not a deploy.
--
-- Every user gets the free plan on sign-up, assigned by the same trigger that
-- creates their profile, so "no subscription row" is never a state the application
-- has to interpret.

CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_code_key" ON "plans" ("code");

-- One row per limit per plan. A key/value shape makes adding a new limit a data
-- change rather than a schema change.
CREATE TABLE "plan_limits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_limits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plan_limits_plan_id_key_key" ON "plan_limits" ("plan_id", "key");

ALTER TABLE "plan_limits"
  ADD CONSTRAINT "plan_limits_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -1 means unlimited; anything else must be a real, non-negative ceiling.
ALTER TABLE "plan_limits"
  ADD CONSTRAINT "plan_limits_value_check"
  CHECK ("value" >= -1);

CREATE TABLE "user_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

-- One subscription per user: two would make "which limits apply" ambiguous.
CREATE UNIQUE INDEX "user_subscriptions_user_id_key" ON "user_subscriptions" ("user_id");
CREATE INDEX "user_subscriptions_plan_id_idx" ON "user_subscriptions" ("plan_id");

ALTER TABLE "user_subscriptions"
  ADD CONSTRAINT "user_subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_subscriptions"
  ADD CONSTRAINT "user_subscriptions_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_subscriptions"
  ADD CONSTRAINT "user_subscriptions_status_check"
  CHECK ("status" IN ('active', 'past_due', 'cancelled'));

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

INSERT INTO "plans" ("id", "code", "name", "rank", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'free', 'Free', 0, now(), now()),
  (gen_random_uuid(), 'pro',  'Pro',  10, now(), now()),
  (gen_random_uuid(), 'max',  'Max',  20, now(), now())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "plan_limits" ("id", "plan_id", "key", "value", "created_at", "updated_at")
SELECT gen_random_uuid(), p.id, l.key, l.value, now(), now()
FROM "plans" p
JOIN (
  VALUES
    ('free', 'max_projects', 5),
    ('free', 'max_components_per_project', 20),
    ('free', 'max_connections_per_project', 50),
    ('free', 'max_storage_mb', 1024),
    ('free', 'max_build_minutes', 120),
    ('free', 'max_ai_requests', 5000),

    ('pro',  'max_projects', 50),
    ('pro',  'max_components_per_project', 100),
    ('pro',  'max_connections_per_project', 300),
    ('pro',  'max_storage_mb', 10240),
    ('pro',  'max_build_minutes', 1200),
    ('pro',  'max_ai_requests', 50000),

    ('max',  'max_projects', -1),
    ('max',  'max_components_per_project', -1),
    ('max',  'max_connections_per_project', -1),
    ('max',  'max_storage_mb', 102400),
    ('max',  'max_build_minutes', 12000),
    ('max',  'max_ai_requests', 500000)
) AS l(plan_code, key, value) ON l.plan_code = p.code
ON CONFLICT ("plan_id", "key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_subscriptions" ENABLE ROW LEVEL SECURITY;

-- Plans and their limits are public product information.
CREATE POLICY "plans_select_all" ON "plans"
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "plan_limits_select_all" ON "plan_limits"
  FOR SELECT TO authenticated USING (true);

-- A user sees only their own subscription, and can never change it: an upgrade
-- goes through the backend, never through a direct table write.
CREATE POLICY "user_subscriptions_select_self" ON "user_subscriptions"
  FOR SELECT TO authenticated USING ("user_id" = auth.uid());

-- ---------------------------------------------------------------------------
-- Assign the free plan on sign-up
--
-- Extends the existing profile trigger rather than adding a second one, so a new
-- account gets its profile, workspace, and subscription in one transaction.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_role_id UUID;
  free_plan_id UUID;
  candidate_username TEXT;
  final_username TEXT;
  final_slug TEXT;
  suffix INT := 0;
  new_workspace_id UUID;
BEGIN
  SELECT id INTO default_role_id FROM roles WHERE name = 'user';
  IF default_role_id IS NULL THEN
    RAISE EXCEPTION 'Default role "user" is not configured';
  END IF;

  candidate_username := COALESCE(
    NULLIF(NEW.raw_user_meta_data ->> 'user_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'preferred_username', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    NEW.id::TEXT
  );

  candidate_username := regexp_replace(lower(candidate_username), '[^a-z0-9._-]', '', 'g');
  IF candidate_username = '' THEN
    candidate_username := 'user';
  END IF;
  candidate_username := left(candidate_username, 40);

  final_username := candidate_username;
  WHILE EXISTS (SELECT 1 FROM users WHERE username = final_username) LOOP
    suffix := suffix + 1;
    final_username := left(candidate_username, 34) || '-' || suffix::TEXT;
  END LOOP;

  INSERT INTO users (id, username, email, is_active, role_id, created_at, updated_at)
  VALUES (
    NEW.id,
    final_username,
    COALESCE(NEW.email, NEW.id::TEXT || '@placeholder.local'),
    TRUE,
    default_role_id,
    now(),
    now()
  );

  final_slug := final_username;
  suffix := 0;
  WHILE EXISTS (SELECT 1 FROM workspaces WHERE slug = final_slug) LOOP
    suffix := suffix + 1;
    final_slug := left(final_username, 34) || '-' || suffix::TEXT;
  END LOOP;

  INSERT INTO workspaces (id, name, slug, owner_id, created_at, updated_at)
  VALUES (gen_random_uuid(), final_username, final_slug, NEW.id, now(), now())
  RETURNING id INTO new_workspace_id;

  INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at)
  VALUES (gen_random_uuid(), new_workspace_id, NEW.id, 'owner', now(), now());

  -- Deliberately no sample projects, devices, or connections. A new account
  -- starts empty; demo content belongs to a separate demo environment only.
  SELECT id INTO free_plan_id FROM plans WHERE code = 'free';
  IF free_plan_id IS NOT NULL THEN
    INSERT INTO user_subscriptions (id, user_id, plan_id, status, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.id, free_plan_id, 'active', now(), now())
    ON CONFLICT ("user_id") DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill: accounts created before this table existed.
INSERT INTO user_subscriptions (id, user_id, plan_id, status, created_at, updated_at)
SELECT gen_random_uuid(), u.id, p.id, 'active', now(), now()
FROM users u
CROSS JOIN plans p
WHERE p.code = 'free'
ON CONFLICT ("user_id") DO NOTHING;
