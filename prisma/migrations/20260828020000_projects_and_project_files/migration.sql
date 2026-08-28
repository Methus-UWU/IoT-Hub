-- Projects and project files.
--
-- Replaces the API-local filesystem (.workspace-data/<userId>/<projectId>/) as the
-- home for user source code. That directory made files unqueryable, unshareable,
-- unbackupable, and tied to one API host; ownership was implied by a path segment
-- rather than recorded anywhere.
--
-- Content lives in a TEXT column rather than Supabase Storage. See
-- docs/adr/ADR-004-project-file-storage.md: these are small source files edited by
-- an autosaving IDE, and keeping them in Postgres makes a save atomic and versioned
-- instead of a two-phase write that can leave a row pointing at a missing object.
-- Build artifacts and binary assets do belong in Storage, and arrive with Phase 4.

CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "board" TEXT NOT NULL DEFAULT '',
    "framework" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- Slugs are unique per workspace, not globally: two teams may both have "greenhouse".
CREATE UNIQUE INDEX "projects_workspace_id_slug_key" ON "projects" ("workspace_id", "slug");
CREATE INDEX "projects_workspace_id_idx" ON "projects" ("workspace_id");

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "project_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    -- Optimistic concurrency. A write states the version it read; a mismatch is
    -- rejected rather than silently overwriting a newer revision.
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_files_pkey" PRIMARY KEY ("id")
);

-- One row per path per project. This is what makes a duplicate path impossible,
-- rather than trusting the application to check first.
CREATE UNIQUE INDEX "project_files_project_id_path_key" ON "project_files" ("project_id", "path");
CREATE INDEX "project_files_project_id_idx" ON "project_files" ("project_id");

ALTER TABLE "project_files"
  ADD CONSTRAINT "project_files_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defence in depth behind the application's own validation. These bounds are
-- deliberately the same numbers the service enforces, so a bug there cannot write a
-- row the database would have refused.
ALTER TABLE "project_files"
  ADD CONSTRAINT "project_files_size_check"
  CHECK ("size_bytes" >= 0 AND "size_bytes" <= 524288);

ALTER TABLE "project_files"
  ADD CONSTRAINT "project_files_version_check"
  CHECK ("version" >= 1);

-- Rejects path traversal, absolute paths, and unsafe segments at the storage layer.
-- Mirrors normalizeProjectFilePath() in the API; both must change together.
ALTER TABLE "project_files"
  ADD CONSTRAINT "project_files_path_check"
  CHECK (
    "path" <> ''
    AND length("path") <= 240
    AND "path" !~ '(^|/)\.\.?(/|$)'
    AND "path" !~ '^/'
    AND "path" !~ '//'
    AND "path" !~ '\\'
    AND "path" ~ '^[a-zA-Z0-9][a-zA-Z0-9._/-]*$'
  );

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Same posture as the rest of the schema: NestJS is the authority and connects as a
-- privileged role, so these policies protect the paths that carry an end user's
-- token — Storage, Realtime, and any direct PostgREST access.
-- ---------------------------------------------------------------------------

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_files" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select_members" ON "projects"
  FOR SELECT TO authenticated
  USING (public.has_workspace_access("workspace_id", 'viewer'));

CREATE POLICY "projects_write_editors" ON "projects"
  FOR ALL TO authenticated
  USING (public.has_workspace_access("workspace_id", 'editor'))
  WITH CHECK (public.has_workspace_access("workspace_id", 'editor'));

CREATE OR REPLACE FUNCTION public.has_project_access(
  target_project_id UUID,
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
    FROM projects p
    WHERE p.id = target_project_id
      AND public.has_workspace_access(p.workspace_id, minimum_role)
  );
$$;

CREATE POLICY "project_files_select_members" ON "project_files"
  FOR SELECT TO authenticated
  USING (public.has_project_access("project_id", 'viewer'));

CREATE POLICY "project_files_write_editors" ON "project_files"
  FOR ALL TO authenticated
  USING (public.has_project_access("project_id", 'editor'))
  WITH CHECK (public.has_project_access("project_id", 'editor'));
