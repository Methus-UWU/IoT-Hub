-- Wires between component pins.
--
-- A connection references pins, not screen coordinates: moving either component
-- must preserve the wire, and a saved layout must survive a change to a
-- component's artwork. `waypoints` holds only the bends a user added by hand;
-- the rest of the path is computed by the router at render time, so a routing
-- improvement applies to existing projects instead of freezing their geometry.

CREATE TABLE "project_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "from_component_id" UUID NOT NULL,
    -- Pin name within the component definition, e.g. 'GPIO23'. Not a uuid: pins
    -- belong to the catalog, which is code rather than a table.
    "from_pin_id" TEXT NOT NULL,
    "to_component_id" UUID NOT NULL,
    "to_pin_id" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "kind" TEXT NOT NULL DEFAULT 'signal',
    -- Manual bend points only, ordered from source to target.
    "waypoints" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_connections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_connections_project_id_idx" ON "project_connections" ("project_id");
CREATE INDEX "project_connections_from_component_id_idx"
  ON "project_connections" ("from_component_id");
CREATE INDEX "project_connections_to_component_id_idx"
  ON "project_connections" ("to_component_id");

ALTER TABLE "project_connections"
  ADD CONSTRAINT "project_connections_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deleting a component takes its wires with it. Without this a wire would point
-- at a component that no longer exists and the canvas would have to filter for
-- that on every render.
ALTER TABLE "project_connections"
  ADD CONSTRAINT "project_connections_from_component_id_fkey"
  FOREIGN KEY ("from_component_id") REFERENCES "project_components" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_connections"
  ADD CONSTRAINT "project_connections_to_component_id_fkey"
  FOREIGN KEY ("to_component_id") REFERENCES "project_components" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A pin cannot be wired to itself on the same component.
ALTER TABLE "project_connections"
  ADD CONSTRAINT "project_connections_distinct_endpoints_check"
  CHECK (
    "from_component_id" <> "to_component_id"
    OR "from_pin_id" <> "to_pin_id"
  );

ALTER TABLE "project_connections"
  ADD CONSTRAINT "project_connections_kind_check"
  CHECK ("kind" IN ('power', 'ground', 'signal'));

ALTER TABLE "project_connections"
  ADD CONSTRAINT "project_connections_pin_format_check"
  CHECK (
    length("from_pin_id") BETWEEN 1 AND 64
    AND length("to_pin_id") BETWEEN 1 AND 64
  );

-- The same two pins may only be wired together once. Ordering the pair before
-- comparison makes A→B and B→A the same connection, which is what an electrical
-- node actually is.
CREATE UNIQUE INDEX "project_connections_unique_pair"
  ON "project_connections" (
    "project_id",
    LEAST("from_component_id"::text || ':' || "from_pin_id",
          "to_component_id"::text || ':' || "to_pin_id"),
    GREATEST("from_component_id"::text || ':' || "from_pin_id",
             "to_component_id"::text || ':' || "to_pin_id")
  );

-- ---------------------------------------------------------------------------
-- Row Level Security — same posture as the rest of a project's contents.
-- ---------------------------------------------------------------------------

ALTER TABLE "project_connections" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_connections_select_members" ON "project_connections"
  FOR SELECT TO authenticated
  USING (public.has_project_access("project_id", 'viewer'));

CREATE POLICY "project_connections_write_editors" ON "project_connections"
  FOR ALL TO authenticated
  USING (public.has_project_access("project_id", 'editor'))
  WITH CHECK (public.has_project_access("project_id", 'editor'));
