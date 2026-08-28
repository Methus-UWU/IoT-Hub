-- Component instances placed in a project.
--
-- The distinction this table encodes: a *definition* describes what an ESP32
-- DevKit V1 is — its outline, pin names, pin positions, capabilities — and lives in
-- the frontend catalog, identical for everyone. An *instance* is where one
-- particular ESP32 sits inside one particular user's project. Only the instance is
-- user data, so only the instance is stored here.
--
-- `definition_id` therefore references the catalog by id rather than copying its
-- geometry: a corrected pin position must not require rewriting every saved
-- project.

CREATE TABLE "project_components" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    -- Catalog key, e.g. 'esp32-devkit-v1'. Not a foreign key: the catalog is code,
    -- not a table.
    "definition_id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    -- Per-instance property values (resistance, colour, servo angle …). Defaults
    -- come from the definition, so only overrides are stored.
    "state" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_components_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_components_project_id_idx" ON "project_components" ("project_id");

ALTER TABLE "project_components"
  ADD CONSTRAINT "project_components_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rotation is stored normalised so equality comparisons and the inspector agree.
ALTER TABLE "project_components"
  ADD CONSTRAINT "project_components_rotation_check"
  CHECK ("rotation" >= 0 AND "rotation" < 360);

-- Keeps a component inside the usable workspace. Generous enough for a large
-- canvas, bounded enough that a bad drag cannot store a component a million
-- pixels away where no one can find it.
ALTER TABLE "project_components"
  ADD CONSTRAINT "project_components_position_check"
  CHECK ("x" >= -100000 AND "x" <= 100000 AND "y" >= -100000 AND "y" <= 100000);

ALTER TABLE "project_components"
  ADD CONSTRAINT "project_components_definition_check"
  CHECK ("definition_id" ~ '^[a-z0-9][a-z0-9._-]{0,63}$');

-- ---------------------------------------------------------------------------
-- Row Level Security — same posture as project_files.
-- ---------------------------------------------------------------------------

ALTER TABLE "project_components" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_components_select_members" ON "project_components"
  FOR SELECT TO authenticated
  USING (public.has_project_access("project_id", 'viewer'));

CREATE POLICY "project_components_write_editors" ON "project_components"
  FOR ALL TO authenticated
  USING (public.has_project_access("project_id", 'editor'))
  WITH CHECK (public.has_project_access("project_id", 'editor'));
