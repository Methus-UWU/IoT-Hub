-- AI profiles and server-side conversations for the project assistant.
--
-- Until now a conversation lived only in the browser's sessionStorage. It was lost
-- when the tab closed, it was shared across every project the tab opened, and the
-- model choice was hard-coded per request. These three tables are all additive. No
-- existing table or column changes.
--
--   ai_profiles       model, reasoning tier, and extra instructions (personal or system)
--   ai_conversations  one chat, private to one user, tied to one project
--   ai_messages       the turns of a chat, with the plan an assistant turn proposed
--
-- A conversation points at a profile but does not copy it. Changing the profile
-- changes how the next turn is answered and keeps every earlier message.

-- ---------------------------------------------------------------------------
-- 1. Profiles
-- ---------------------------------------------------------------------------

CREATE TABLE "ai_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    -- Explicit catalog model id; NULL lets the server rank the catalog for "tier".
    "model" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'auto',
    -- Appended to the platform's system prompt, never replacing it.
    "instructions" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    -- NULL: a system profile, managed by platform admins and offered to everyone.
    "owner_id" UUID,

    CONSTRAINT "ai_profiles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_profiles_owner_id_idx" ON "ai_profiles" ("owner_id");

ALTER TABLE "ai_profiles"
  ADD CONSTRAINT "ai_profiles_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_profiles"
  ADD CONSTRAINT "ai_profiles_name_check"
  CHECK (char_length(btrim("name")) BETWEEN 1 AND 60);

ALTER TABLE "ai_profiles"
  ADD CONSTRAINT "ai_profiles_description_check"
  CHECK (char_length("description") <= 200);

ALTER TABLE "ai_profiles"
  ADD CONSTRAINT "ai_profiles_model_check"
  CHECK ("model" IS NULL OR char_length("model") BETWEEN 1 AND 160);

ALTER TABLE "ai_profiles"
  ADD CONSTRAINT "ai_profiles_tier_check"
  CHECK ("tier" IN ('auto', 'balanced', 'deep'));

ALTER TABLE "ai_profiles"
  ADD CONSTRAINT "ai_profiles_instructions_check"
  CHECK (char_length("instructions") <= 4000);

-- ---------------------------------------------------------------------------
-- 2. Conversations
-- ---------------------------------------------------------------------------

CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "profile_id" UUID,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_conversations_user_id_project_id_updated_at_idx"
  ON "ai_conversations" ("user_id", "project_id", "updated_at" DESC);
CREATE INDEX "ai_conversations_project_id_idx" ON "ai_conversations" ("project_id");
CREATE INDEX "ai_conversations_profile_id_idx" ON "ai_conversations" ("profile_id");

ALTER TABLE "ai_conversations"
  ADD CONSTRAINT "ai_conversations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_conversations"
  ADD CONSTRAINT "ai_conversations_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deleting a profile keeps its conversations; they fall back to the default.
ALTER TABLE "ai_conversations"
  ADD CONSTRAINT "ai_conversations_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "ai_profiles" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_conversations"
  ADD CONSTRAINT "ai_conversations_title_check"
  CHECK (char_length("title") <= 80);

-- ---------------------------------------------------------------------------
-- 3. Messages
-- ---------------------------------------------------------------------------

CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "plan" JSONB,
    "plan_state" TEXT,
    "plan_error" TEXT,
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversation_id" UUID NOT NULL,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_messages_conversation_id_created_at_idx"
  ON "ai_messages" ("conversation_id", "created_at");

ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_role_check"
  CHECK ("role" IN ('user', 'assistant'));

ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_content_check"
  CHECK (char_length("content") <= 50000);

ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_plan_state_check"
  CHECK ("plan_state" IS NULL OR "plan_state" IN ('pending', 'applied', 'failed', 'dismissed'));

-- A plan is at most a few files of source; this bounds what one row can hold.
ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_plan_size_check"
  CHECK ("plan" IS NULL OR pg_column_size("plan") <= 2097152);

-- ---------------------------------------------------------------------------
-- 4. Row Level Security — defence in depth; NestJS stays the authority.
-- ---------------------------------------------------------------------------

ALTER TABLE "ai_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;

-- Your own profiles and the system ones.
CREATE POLICY "ai_profiles_select_own_or_system" ON "ai_profiles"
  FOR SELECT TO authenticated
  USING ("owner_id" IS NULL OR "owner_id" = auth.uid());

-- Your own conversations, and only while you can still see the project.
CREATE POLICY "ai_conversations_select_own" ON "ai_conversations"
  FOR SELECT TO authenticated
  USING ("user_id" = auth.uid() AND public.has_project_access("project_id", 'viewer'));

CREATE POLICY "ai_messages_select_own" ON "ai_messages"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "ai_conversations" c
      WHERE c."id" = "conversation_id"
        AND c."user_id" = auth.uid()
        AND public.has_project_access(c."project_id", 'viewer')
    )
  );

-- Same posture as 20260926000000_harden_data_api_privileges: writes go through
-- NestJS, the Data API may only read what a policy allows.
REVOKE ALL ON TABLE "ai_profiles" FROM anon, authenticated;
REVOKE ALL ON TABLE "ai_conversations" FROM anon, authenticated;
REVOKE ALL ON TABLE "ai_messages" FROM anon, authenticated;
GRANT SELECT ON TABLE "ai_profiles" TO authenticated;
GRANT SELECT ON TABLE "ai_conversations" TO authenticated;
GRANT SELECT ON TABLE "ai_messages" TO authenticated;
