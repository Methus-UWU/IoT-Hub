-- Devices and telemetry: real boards report datastream values to their project.
--
-- Until now a dashboard widget bound to a datastream had nothing to show: there was
-- no device record, no way for a board to authenticate, and no stored readings. Three
-- tables, all additive. No existing table or column changes.
--
--   devices           a board that reports to one project, authenticated by a token
--   device_values     latest value per device and datastream (reported or set by a control)
--   telemetry_points  reported history, for charts
--
-- A device token is shown to the user once. Only its SHA-256 is stored, so a database
-- read cannot impersonate a device.

-- ---------------------------------------------------------------------------
-- 1. Devices
-- ---------------------------------------------------------------------------

CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_hint" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "project_id" UUID NOT NULL,
    "created_by" UUID,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "devices_token_hash_key" ON "devices" ("token_hash");
CREATE INDEX "devices_project_id_idx" ON "devices" ("project_id");
CREATE INDEX "devices_created_by_idx" ON "devices" ("created_by");

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_name_check"
  CHECK (char_length(btrim("name")) BETWEEN 1 AND 60);

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_token_hash_check"
  CHECK ("token_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_token_hint_check"
  CHECK (char_length("token_hint") <= 8);

-- ---------------------------------------------------------------------------
-- 2. Latest values
-- ---------------------------------------------------------------------------

CREATE TABLE "device_values" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" UUID NOT NULL,

    CONSTRAINT "device_values_pkey" PRIMARY KEY ("device_id", "key")
);

ALTER TABLE "device_values"
  ADD CONSTRAINT "device_values_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same rule as a datastream key (project_datastreams_key_check).
ALTER TABLE "device_values"
  ADD CONSTRAINT "device_values_key_check"
  CHECK ("key" ~ '^[A-Za-z][A-Za-z0-9_]{0,31}$');

ALTER TABLE "device_values"
  ADD CONSTRAINT "device_values_source_check"
  CHECK ("source" IN ('device', 'app'));

ALTER TABLE "device_values"
  ADD CONSTRAINT "device_values_value_check"
  CHECK (jsonb_typeof("value") IN ('number', 'boolean', 'string') AND pg_column_size("value") <= 1024);

-- ---------------------------------------------------------------------------
-- 3. History
-- ---------------------------------------------------------------------------

CREATE TABLE "telemetry_points" (
    "id" BIGSERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "text" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" UUID NOT NULL,

    CONSTRAINT "telemetry_points_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "telemetry_points_device_id_key_recorded_at_idx"
  ON "telemetry_points" ("device_id", "key", "recorded_at" DESC);
-- Retention deletes by age across all devices.
CREATE INDEX "telemetry_points_recorded_at_idx" ON "telemetry_points" ("recorded_at");

ALTER TABLE "telemetry_points"
  ADD CONSTRAINT "telemetry_points_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "telemetry_points"
  ADD CONSTRAINT "telemetry_points_key_check"
  CHECK ("key" ~ '^[A-Za-z][A-Za-z0-9_]{0,31}$');

-- Exactly one of a number or a text reading.
ALTER TABLE "telemetry_points"
  ADD CONSTRAINT "telemetry_points_value_check"
  CHECK (("value" IS NULL) <> ("text" IS NULL) AND ("text" IS NULL OR char_length("text") <= 256));

-- ---------------------------------------------------------------------------
-- 4. Row Level Security — defence in depth; NestJS stays the authority.
-- ---------------------------------------------------------------------------

ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "telemetry_points" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "devices_select_members" ON "devices"
  FOR SELECT TO authenticated
  USING (public.has_project_access("project_id", 'viewer'));

CREATE POLICY "device_values_select_members" ON "device_values"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "devices" d
      WHERE d."id" = "device_id" AND public.has_project_access(d."project_id", 'viewer')
    )
  );

CREATE POLICY "telemetry_points_select_members" ON "telemetry_points"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "devices" d
      WHERE d."id" = "device_id" AND public.has_project_access(d."project_id", 'viewer')
    )
  );

-- Same posture as 20260926000000_harden_data_api_privileges: writes go through
-- NestJS, the Data API may only read what a policy allows. The token hash is not
-- readable through the Data API at all.
REVOKE ALL ON TABLE "devices" FROM anon, authenticated;
REVOKE ALL ON TABLE "device_values" FROM anon, authenticated;
REVOKE ALL ON TABLE "telemetry_points" FROM anon, authenticated;
REVOKE ALL ON SEQUENCE "telemetry_points_id_seq" FROM anon, authenticated;
GRANT SELECT ("id", "name", "token_hint", "last_seen_at", "created_at", "updated_at", "project_id", "created_by")
  ON TABLE "devices" TO authenticated;
GRANT SELECT ON TABLE "device_values" TO authenticated;
GRANT SELECT ON TABLE "telemetry_points" TO authenticated;
