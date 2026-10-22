-- Community: questions, answers, votes, tags.
--
-- Three design points that are not obvious from the table list:
--
-- 1. Counters (`score`, `comment_count`, `post_count`) are denormalised and kept
--    by triggers rather than recomputed per read. The feed sorts and paginates on
--    them; an aggregate per row would turn the first page into a full scan of the
--    vote table, and doing it in the API would leave the numbers wrong whenever a
--    row is touched by anything else, including a cascade delete.
-- 2. Votes live in one table with a nullable post_id and comment_id, constrained
--    so exactly one is set. "Which way did I vote" is then one lookup, and the
--    score trigger exists once instead of twice.
-- 3. Reads are public. Anonymous visitors may SELECT published posts, which is
--    the point of a community; every write is restricted to its author.

CREATE TABLE "community_tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "post_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "community_tags_slug_key" ON "community_tags" ("slug");

ALTER TABLE "community_tags"
  ADD CONSTRAINT "community_tags_slug_format_check"
  CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$');

CREATE TABLE "community_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "author_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'question',
    "title" TEXT NOT NULL,
    -- Unicode, so a Thai title keeps its own letters instead of slugifying to
    -- nothing. A random suffix, added by the API, makes it unique.
    "slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "score" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_comment_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "community_posts_slug_key" ON "community_posts" ("slug");
CREATE UNIQUE INDEX "community_posts_accepted_comment_id_key"
  ON "community_posts" ("accepted_comment_id");

-- One index per sort order the feed offers. Each ends in "id" because pagination
-- is keyset, not offset: the cursor is (sort value, id) and the index has to be
-- able to seek straight to it.
CREATE INDEX "community_posts_created_at_id_idx"
  ON "community_posts" ("created_at" DESC, "id" DESC);
CREATE INDEX "community_posts_score_id_idx"
  ON "community_posts" ("score" DESC, "id" DESC);
CREATE INDEX "community_posts_last_activity_at_id_idx"
  ON "community_posts" ("last_activity_at" DESC, "id" DESC);
CREATE INDEX "community_posts_author_id_idx" ON "community_posts" ("author_id");

ALTER TABLE "community_posts"
  ADD CONSTRAINT "community_posts_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "community_posts"
  ADD CONSTRAINT "community_posts_kind_check"
  CHECK ("kind" IN ('question', 'discussion', 'showcase'));

ALTER TABLE "community_posts"
  ADD CONSTRAINT "community_posts_status_check"
  CHECK ("status" IN ('published', 'hidden'));

ALTER TABLE "community_posts"
  ADD CONSTRAINT "community_posts_title_length_check"
  CHECK (char_length("title") BETWEEN 10 AND 160);

ALTER TABLE "community_posts"
  ADD CONSTRAINT "community_posts_body_length_check"
  CHECK (char_length("body") BETWEEN 20 AND 20000);

CREATE TABLE "community_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "post_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    -- NULL for an answer, set for a reply to one. One level only; the API
    -- rejects a reply whose parent already has a parent.
    "parent_id" UUID,
    "body" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "community_comments_post_id_created_at_idx"
  ON "community_comments" ("post_id", "created_at");
CREATE INDEX "community_comments_author_id_idx" ON "community_comments" ("author_id");
CREATE INDEX "community_comments_parent_id_idx" ON "community_comments" ("parent_id");

ALTER TABLE "community_comments"
  ADD CONSTRAINT "community_comments_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "community_posts" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "community_comments"
  ADD CONSTRAINT "community_comments_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "community_comments"
  ADD CONSTRAINT "community_comments_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "community_comments" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "community_comments"
  ADD CONSTRAINT "community_comments_body_length_check"
  CHECK (char_length("body") BETWEEN 2 AND 20000);

-- Added after the comments table exists: the two tables reference each other.
ALTER TABLE "community_posts"
  ADD CONSTRAINT "community_posts_accepted_comment_id_fkey"
  FOREIGN KEY ("accepted_comment_id") REFERENCES "community_comments" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "community_post_tags" (
    "post_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_tags_pkey" PRIMARY KEY ("post_id", "tag_id")
);

CREATE INDEX "community_post_tags_tag_id_idx" ON "community_post_tags" ("tag_id");

ALTER TABLE "community_post_tags"
  ADD CONSTRAINT "community_post_tags_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "community_posts" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "community_post_tags"
  ADD CONSTRAINT "community_post_tags_tag_id_fkey"
  FOREIGN KEY ("tag_id") REFERENCES "community_tags" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "community_votes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "post_id" UUID,
    "comment_id" UUID,
    -- Only -1 and 1 are stored. Clearing a vote deletes the row, so "no opinion"
    -- has exactly one representation instead of two.
    "value" SMALLINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_votes_pkey" PRIMARY KEY ("id")
);

-- NULLs are distinct in a unique index, so a user's post votes and comment votes
-- do not collide: each pair below only constrains rows where the column is set.
CREATE UNIQUE INDEX "community_votes_user_id_post_id_key"
  ON "community_votes" ("user_id", "post_id");
CREATE UNIQUE INDEX "community_votes_user_id_comment_id_key"
  ON "community_votes" ("user_id", "comment_id");
CREATE INDEX "community_votes_post_id_idx" ON "community_votes" ("post_id");
CREATE INDEX "community_votes_comment_id_idx" ON "community_votes" ("comment_id");

ALTER TABLE "community_votes"
  ADD CONSTRAINT "community_votes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "community_votes"
  ADD CONSTRAINT "community_votes_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "community_posts" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "community_votes"
  ADD CONSTRAINT "community_votes_comment_id_fkey"
  FOREIGN KEY ("comment_id") REFERENCES "community_comments" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "community_votes"
  ADD CONSTRAINT "community_votes_value_check"
  CHECK ("value" IN (-1, 1));

ALTER TABLE "community_votes"
  ADD CONSTRAINT "community_votes_single_target_check"
  CHECK (num_nonnulls("post_id", "comment_id") = 1);

-- Counter maintenance -------------------------------------------------------
--
-- These run on every path that changes a row, including cascade deletes, which
-- is why they are triggers and not service code.

CREATE OR REPLACE FUNCTION public.community_apply_vote_delta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_value SMALLINT := 0;
  new_value SMALLINT := 0;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_value := OLD."value";
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_value := NEW."value";
  END IF;

  -- A vote never moves between targets (the API deletes and re-inserts), so the
  -- old and new rows always point at the same post or comment.
  IF COALESCE(NEW."post_id", OLD."post_id") IS NOT NULL THEN
    UPDATE "community_posts"
       SET "score" = "score" + (new_value - old_value)
     WHERE "id" = COALESCE(NEW."post_id", OLD."post_id");
  ELSE
    UPDATE "community_comments"
       SET "score" = "score" + (new_value - old_value)
     WHERE "id" = COALESCE(NEW."comment_id", OLD."comment_id");
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "community_votes_score_trigger"
AFTER INSERT OR UPDATE OF "value" OR DELETE ON "community_votes"
FOR EACH ROW EXECUTE FUNCTION public.community_apply_vote_delta();

CREATE OR REPLACE FUNCTION public.community_apply_comment_delta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "community_posts"
       SET "comment_count" = "comment_count" + 1,
           "last_activity_at" = CURRENT_TIMESTAMP
     WHERE "id" = NEW."post_id";
  ELSE
    -- No last_activity_at bump: removing an answer is not activity, and bumping
    -- here would push deleted threads back to the top of the "active" feed.
    UPDATE "community_posts"
       SET "comment_count" = GREATEST("comment_count" - 1, 0)
     WHERE "id" = OLD."post_id";
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "community_comments_count_trigger"
AFTER INSERT OR DELETE ON "community_comments"
FOR EACH ROW EXECUTE FUNCTION public.community_apply_comment_delta();

CREATE OR REPLACE FUNCTION public.community_apply_tag_delta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "community_tags"
       SET "post_count" = "post_count" + 1
     WHERE "id" = NEW."tag_id";
  ELSE
    UPDATE "community_tags"
       SET "post_count" = GREATEST("post_count" - 1, 0)
     WHERE "id" = OLD."tag_id";
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "community_post_tags_count_trigger"
AFTER INSERT OR DELETE ON "community_post_tags"
FOR EACH ROW EXECUTE FUNCTION public.community_apply_tag_delta();

-- Row Level Security --------------------------------------------------------
--
-- Defence in depth for anything reaching these tables with a Supabase key. The
-- API connects as the schema owner and is authorized by its own policy layer.

ALTER TABLE "community_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "community_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "community_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "community_post_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "community_votes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "community_tags_select_public" ON "community_tags"
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "community_posts_select_public" ON "community_posts"
  FOR SELECT TO anon, authenticated
  USING ("status" = 'published');

CREATE POLICY "community_posts_insert_author" ON "community_posts"
  FOR INSERT TO authenticated
  WITH CHECK ("author_id" = auth.uid());

CREATE POLICY "community_posts_update_author" ON "community_posts"
  FOR UPDATE TO authenticated
  USING ("author_id" = auth.uid())
  WITH CHECK ("author_id" = auth.uid());

CREATE POLICY "community_posts_delete_author" ON "community_posts"
  FOR DELETE TO authenticated
  USING ("author_id" = auth.uid());

CREATE POLICY "community_comments_select_public" ON "community_comments"
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "community_posts" p
       WHERE p."id" = "community_comments"."post_id"
         AND p."status" = 'published'
    )
  );

CREATE POLICY "community_comments_insert_author" ON "community_comments"
  FOR INSERT TO authenticated
  WITH CHECK ("author_id" = auth.uid());

CREATE POLICY "community_comments_update_author" ON "community_comments"
  FOR UPDATE TO authenticated
  USING ("author_id" = auth.uid())
  WITH CHECK ("author_id" = auth.uid());

CREATE POLICY "community_comments_delete_author" ON "community_comments"
  FOR DELETE TO authenticated
  USING ("author_id" = auth.uid());

CREATE POLICY "community_post_tags_select_public" ON "community_post_tags"
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "community_post_tags_write_post_author" ON "community_post_tags"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "community_posts" p
       WHERE p."id" = "community_post_tags"."post_id"
         AND p."author_id" = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "community_posts" p
       WHERE p."id" = "community_post_tags"."post_id"
         AND p."author_id" = auth.uid()
    )
  );

-- Deliberately not public: a vote is private, only its aggregate is not.
CREATE POLICY "community_votes_own_rows" ON "community_votes"
  FOR ALL TO authenticated
  USING ("user_id" = auth.uid())
  WITH CHECK ("user_id" = auth.uid());

-- Seed tags -----------------------------------------------------------------
--
-- The catalog ships with the migration so the feed has somewhere to file a post
-- on day one. Adding a tag later is another migration, which is the intent: an
-- open tag space fills with near-duplicates.

INSERT INTO "community_tags" ("slug", "name", "description") VALUES
  ('esp32', 'ESP32', 'บอร์ด ESP32 และการตั้งค่า'),
  ('esp8266', 'ESP8266', 'บอร์ด ESP8266 และ NodeMCU'),
  ('arduino', 'Arduino', 'บอร์ดและไลบรารีตระกูล Arduino'),
  ('raspberry-pi', 'Raspberry Pi', 'Raspberry Pi และระบบลินุกซ์ฝังตัว'),
  ('sensors', 'เซนเซอร์', 'การอ่านค่าและการต่อเซนเซอร์'),
  ('wiring', 'การต่อวงจร', 'การเดินสาย ไฟเลี้ยง และวงจรพื้นฐาน'),
  ('mqtt', 'MQTT', 'โพรโทคอล MQTT และโบรกเกอร์'),
  ('wifi', 'Wi-Fi', 'การเชื่อมต่อเครือข่ายไร้สาย'),
  ('firmware', 'เฟิร์มแวร์', 'การเขียนและแฟลชเฟิร์มแวร์'),
  ('dashboard', 'แดชบอร์ด', 'การแสดงผลข้อมูลและวิดเจ็ต'),
  ('power', 'ไฟเลี้ยง', 'แบตเตอรี่ การประหยัดพลังงาน และแรงดัน'),
  ('troubleshooting', 'แก้ปัญหา', 'อาการเสีย ข้อผิดพลาด และการไล่จุดบกพร่อง')
ON CONFLICT ("slug") DO NOTHING;
