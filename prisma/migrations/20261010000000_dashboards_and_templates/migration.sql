-- Dashboards, datastreams, and reusable dashboard templates.
--
-- Until now a project's dashboard lived only in the browser's localStorage: it did
-- not follow the user to another machine, no other member could see it, and the
-- assistant could not read or change it. Four tables, all additive — no existing
-- table or column changes.
--
--   project_datastreams          what a widget binds to (Blynk's "datastream")
--   project_dashboards           one dashboard document per project
--   dashboard_templates          a reusable dashboard, owned by a workspace
--   dashboard_template_versions  immutable revisions of a template
--
-- A project made from a template holds a copy of the template's document, so
-- editing the project's layout never changes the template, and editing the template
-- (a new version) never rewrites dashboards already made from it.

-- ---------------------------------------------------------------------------
-- 1. Datastreams
-- ---------------------------------------------------------------------------

CREATE TABLE "project_datastreams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    -- Shared by the sketch and the widget, e.g. 'temperature' or 'V0'.
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "min" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    -- Component property that produces the value; empty when the sketch computes it.
    "source" TEXT NOT NULL DEFAULT '',
    "component_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_datastreams_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_datastreams_project_id_key_key"
  ON "project_datastreams" ("project_id", "key");
CREATE INDEX "project_datastreams_component_id_idx" ON "project_datastreams" ("component_id");

ALTER TABLE "project_datastreams"
  ADD CONSTRAINT "project_datastreams_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Removing a part leaves the datastream, unbound, rather than silently deleting
-- the widgets' data source with it.
ALTER TABLE "project_datastreams"
  ADD CONSTRAINT "project_datastreams_component_id_fkey"
  FOREIGN KEY ("component_id") REFERENCES "project_components" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_datastreams"
  ADD CONSTRAINT "project_datastreams_key_check"
  CHECK ("key" ~ '^[A-Za-z][A-Za-z0-9_]{0,31}$');

ALTER TABLE "project_datastreams"
  ADD CONSTRAINT "project_datastreams_data_type_check"
  CHECK ("data_type" IN ('number', 'boolean', 'string'));

ALTER TABLE "project_datastreams"
  ADD CONSTRAINT "project_datastreams_text_check"
  CHECK (char_length("name") BETWEEN 1 AND 80
     AND char_length("unit") <= 16
     AND char_length("source") <= 64);

ALTER TABLE "project_datastreams"
  ADD CONSTRAINT "project_datastreams_range_check"
  CHECK ("min" IS NULL OR "max" IS NULL OR "min" < "max");

-- ---------------------------------------------------------------------------
-- 2. Templates (before dashboards, which reference them)
-- ---------------------------------------------------------------------------

CREATE TABLE "dashboard_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "created_by" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "board_id" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "latest_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dashboard_templates_workspace_id_updated_at_idx"
  ON "dashboard_templates" ("workspace_id", "updated_at" DESC);
CREATE INDEX "dashboard_templates_created_by_idx" ON "dashboard_templates" ("created_by");

ALTER TABLE "dashboard_templates"
  ADD CONSTRAINT "dashboard_templates_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deleting an account keeps the workspace's templates.
ALTER TABLE "dashboard_templates"
  ADD CONSTRAINT "dashboard_templates_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dashboard_templates"
  ADD CONSTRAINT "dashboard_templates_visibility_check"
  CHECK ("visibility" IN ('private', 'workspace'));

ALTER TABLE "dashboard_templates"
  ADD CONSTRAINT "dashboard_templates_text_check"
  CHECK (char_length("name") BETWEEN 1 AND 80
     AND char_length("description") <= 500
     AND "board_id" ~ '^[a-z0-9][a-z0-9._-]{0,63}$');

ALTER TABLE "dashboard_templates"
  ADD CONSTRAINT "dashboard_templates_latest_version_check"
  CHECK ("latest_version" >= 1);

CREATE TABLE "dashboard_template_versions" (
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "datastreams" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_template_versions_pkey" PRIMARY KEY ("template_id", "version")
);

CREATE INDEX "dashboard_template_versions_created_by_idx"
  ON "dashboard_template_versions" ("created_by");

ALTER TABLE "dashboard_template_versions"
  ADD CONSTRAINT "dashboard_template_versions_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "dashboard_templates" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dashboard_template_versions"
  ADD CONSTRAINT "dashboard_template_versions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dashboard_template_versions"
  ADD CONSTRAINT "dashboard_template_versions_shape_check"
  CHECK ("version" >= 1
     AND jsonb_typeof("document") = 'object'
     AND jsonb_typeof("datastreams") = 'array'
     AND pg_column_size("document") <= 262144);

-- ---------------------------------------------------------------------------
-- 3. Dashboards
-- ---------------------------------------------------------------------------

CREATE TABLE "project_dashboards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    -- Optimistic concurrency: a save states the version it read.
    "version" INTEGER NOT NULL DEFAULT 1,
    "template_id" UUID,
    "template_version" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_dashboards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_dashboards_project_id_key" ON "project_dashboards" ("project_id");
CREATE INDEX "project_dashboards_template_id_idx" ON "project_dashboards" ("template_id");

ALTER TABLE "project_dashboards"
  ADD CONSTRAINT "project_dashboards_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_dashboards"
  ADD CONSTRAINT "project_dashboards_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "dashboard_templates" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_dashboards"
  ADD CONSTRAINT "project_dashboards_shape_check"
  CHECK ("version" >= 1
     AND char_length("name") BETWEEN 1 AND 80
     AND jsonb_typeof("document") = 'object'
     AND pg_column_size("document") <= 262144
     AND ("template_version" IS NULL OR "template_version" >= 1));

-- ---------------------------------------------------------------------------
-- 4. Row Level Security — defence in depth; NestJS stays the authority.
-- ---------------------------------------------------------------------------

ALTER TABLE "project_datastreams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_dashboards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboard_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboard_template_versions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_datastreams_select_members" ON "project_datastreams"
  FOR SELECT TO authenticated
  USING (public.has_project_access("project_id", 'viewer'));

CREATE POLICY "project_dashboards_select_members" ON "project_dashboards"
  FOR SELECT TO authenticated
  USING (public.has_project_access("project_id", 'viewer'));

-- A private template is its creator's; a workspace template is every member's.
CREATE POLICY "dashboard_templates_select_visible" ON "dashboard_templates"
  FOR SELECT TO authenticated
  USING (
    public.has_workspace_access("workspace_id", 'viewer')
    AND ("visibility" = 'workspace' OR "created_by" = auth.uid())
  );

CREATE POLICY "dashboard_template_versions_select_visible" ON "dashboard_template_versions"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "dashboard_templates" t
      WHERE t."id" = "template_id"
        AND public.has_workspace_access(t."workspace_id", 'viewer')
        AND (t."visibility" = 'workspace' OR t."created_by" = auth.uid())
    )
  );

-- Same posture as 20260926000000_harden_data_api_privileges: writes go through
-- NestJS, the Data API may only read what a policy allows.
REVOKE ALL ON TABLE "project_datastreams" FROM anon, authenticated;
REVOKE ALL ON TABLE "project_dashboards" FROM anon, authenticated;
REVOKE ALL ON TABLE "dashboard_templates" FROM anon, authenticated;
REVOKE ALL ON TABLE "dashboard_template_versions" FROM anon, authenticated;
GRANT SELECT ON TABLE "project_datastreams" TO authenticated;
GRANT SELECT ON TABLE "project_dashboards" TO authenticated;
GRANT SELECT ON TABLE "dashboard_templates" TO authenticated;
GRANT SELECT ON TABLE "dashboard_template_versions" TO authenticated;
