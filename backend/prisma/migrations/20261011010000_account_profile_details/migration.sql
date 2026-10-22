-- Optional presentation fields; existing accounts and signup triggers need no backfill.
-- Existing users SELECT policies and backend-only write privileges still apply.
ALTER TABLE "public"."users"
  ADD COLUMN "display_name" VARCHAR(60),
  ADD COLUMN "bio" VARCHAR(280);
