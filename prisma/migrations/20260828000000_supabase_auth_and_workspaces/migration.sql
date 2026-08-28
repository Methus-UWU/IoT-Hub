-- Supabase Auth adoption and the workspace ownership model.
--
-- Target: the Supabase Cloud project's `public` schema. Supabase owns `auth`,
-- `storage`, and `realtime`; this migration reads `auth.users` and attaches a
-- trigger to it, but never modifies its structure.
--
-- DESTRUCTIVE on any database that still holds legacy auth data: it drops the
-- `sessions` table and `users.password`. That is intended — Supabase Auth owns
-- credentials and sessions from here on, and the accounts in the legacy local
-- database were confirmed to be disposable test accounts. Do not run this against
-- a database whose accounts matter without exporting first.

-- ---------------------------------------------------------------------------
-- 1. Retire the application's own credential and session storage
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS "sessions";

ALTER TABLE "users" DROP COLUMN IF EXISTS "password";

-- `users.id` is no longer generated here: it is the id Supabase Auth assigned.
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;

-- Deleting the auth user removes the profile with it, so no orphan can be left
-- holding a workspace.
ALTER TABLE "users"
  ADD CONSTRAINT "users_id_fkey"
  FOREIGN KEY ("id") REFERENCES auth.users ("id") ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Reference data
-- ---------------------------------------------------------------------------

INSERT INTO "roles" ("id", "name", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'admin', now(), now()),
  (gen_random_uuid(), 'user', now(), now())
ON CONFLICT ("name") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Workspace ownership model
-- ---------------------------------------------------------------------------

CREATE TABLE "workspaces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces" ("slug");
CREATE INDEX "workspaces_owner_id_idx" ON "workspaces" ("owner_id");

ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- One membership row per user per workspace: two rows would make "what may this
-- user do here" ambiguous.
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key"
  ON "workspace_members" ("workspace_id", "user_id");
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members" ("user_id");

ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_role_check"
  CHECK ("role" IN ('owner', 'admin', 'developer', 'editor', 'viewer'));

-- ---------------------------------------------------------------------------
-- 4. Authorization helpers
--
-- SECURITY DEFINER so a policy can consult membership without the caller needing
-- read access to the membership table, which would otherwise recurse.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.workspace_role_rank(role_name TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE role_name
    WHEN 'owner'     THEN 50
    WHEN 'admin'     THEN 40
    WHEN 'developer' THEN 30
    WHEN 'editor'    THEN 20
    WHEN 'viewer'    THEN 10
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_access(
  target_workspace_id UUID,
  minimum_role TEXT DEFAULT 'viewer'
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_members m
    WHERE m.workspace_id = target_workspace_id
      AND m.user_id = auth.uid()
      AND public.workspace_role_rank(m.role)
          >= public.workspace_role_rank(minimum_role)
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
--
-- Defence in depth. NestJS connects as a privileged role and is not constrained by
-- these policies — it remains the primary authorization authority, per
-- docs/SECURITY.md. These policies are what protects the paths that DO carry an end
-- user's token: Supabase Storage, Realtime, and any direct PostgREST access.
-- ---------------------------------------------------------------------------

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;

-- A user reads and edits only their own profile. Nobody creates or deletes a
-- profile directly: the sign-up trigger owns that.
CREATE POLICY "users_select_self" ON "users"
  FOR SELECT TO authenticated
  USING ("id" = auth.uid());

CREATE POLICY "users_update_self" ON "users"
  FOR UPDATE TO authenticated
  USING ("id" = auth.uid())
  WITH CHECK ("id" = auth.uid());

-- Workspaces are visible to their members, and modifiable by admins and owners.
CREATE POLICY "workspaces_select_members" ON "workspaces"
  FOR SELECT TO authenticated
  USING (public.has_workspace_access("id", 'viewer'));

CREATE POLICY "workspaces_update_admins" ON "workspaces"
  FOR UPDATE TO authenticated
  USING (public.has_workspace_access("id", 'admin'))
  WITH CHECK (public.has_workspace_access("id", 'admin'));

CREATE POLICY "workspaces_delete_owner" ON "workspaces"
  FOR DELETE TO authenticated
  USING ("owner_id" = auth.uid());

-- Membership is visible to fellow members; only admins and owners change it.
CREATE POLICY "workspace_members_select" ON "workspace_members"
  FOR SELECT TO authenticated
  USING (public.has_workspace_access("workspace_id", 'viewer'));

CREATE POLICY "workspace_members_write_admins" ON "workspace_members"
  FOR ALL TO authenticated
  USING (public.has_workspace_access("workspace_id", 'admin'))
  WITH CHECK (public.has_workspace_access("workspace_id", 'admin'));

-- Role names are not sensitive; their assignment is, and that lives on `users`.
CREATE POLICY "roles_select_all" ON "roles"
  FOR SELECT TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- 6. Sign-up trigger
--
-- Runs when Supabase Auth creates a user, whatever the provider — email/password,
-- Google, or GitHub. Creates the profile and a personal workspace so that a new
-- account is never in a half-initialised state that the application has to repair.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_role_id UUID;
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

  -- OAuth providers supply different metadata keys; fall back to the local part of
  -- the address, then to the uuid, so a username always exists.
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Keep the profile's email in step when the user changes it through Supabase Auth.
CREATE OR REPLACE FUNCTION public.handle_auth_user_email_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    UPDATE users SET email = NEW.email, updated_at = now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;

CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_email_change();
