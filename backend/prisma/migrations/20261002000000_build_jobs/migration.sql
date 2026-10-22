-- Firmware build queue and build artifacts (Phase 4, ADR-002).
--
-- The queue is this table: the API inserts a queued row, and the build dispatcher
-- claims the oldest one through the API with FOR UPDATE SKIP LOCKED. Neither table
-- is reachable through the Data API: RLS is enabled with no policy and nothing is
-- granted to anon or authenticated. Every read and write goes through NestJS,
-- which checks workspace membership first.

CREATE TABLE "build_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" TEXT NOT NULL DEFAULT 'queued',
    "board_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platform_board" TEXT NOT NULL,
    "source" JSONB,
    "source_hash" TEXT NOT NULL,
    "failure_reason" TEXT,
    "log" TEXT NOT NULL DEFAULT '',
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "lease_expires_at" TIMESTAMP(3),
    "project_id" UUID NOT NULL,
    "requested_by" UUID,

    CONSTRAINT "build_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "build_jobs_status_check"
        CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
    CONSTRAINT "build_jobs_failure_reason_check"
        CHECK ("failure_reason" IS NULL
            OR "failure_reason" IN ('compile', 'rejected', 'timeout', 'worker_error', 'artifacts')),
    CONSTRAINT "build_jobs_log_length" CHECK (char_length("log") <= 65536),
    CONSTRAINT "build_jobs_source_size" CHECK ("source" IS NULL OR octet_length("source"::text) <= 12582912),
    CONSTRAINT "build_jobs_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0),
    -- A finished build never keeps its source snapshot.
    CONSTRAINT "build_jobs_source_cleared"
        CHECK ("status" IN ('queued', 'running') OR "source" IS NULL)
);

CREATE INDEX "build_jobs_project_id_created_at_idx" ON "build_jobs"("project_id", "created_at" DESC);
CREATE INDEX "build_jobs_requested_by_created_at_idx" ON "build_jobs"("requested_by", "created_at");
CREATE INDEX "build_jobs_status_created_at_idx" ON "build_jobs"("status", "created_at");

ALTER TABLE "build_jobs" ADD CONSTRAINT "build_jobs_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "build_jobs" ADD CONSTRAINT "build_jobs_requested_by_fkey"
    FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "build_artifacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "flash_offset" INTEGER,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "build_job_id" UUID NOT NULL,

    CONSTRAINT "build_artifacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "build_artifacts_name_check"
        CHECK ("name" IN ('bootloader.bin', 'partitions.bin', 'boot_app0.bin', 'firmware.bin', 'firmware.hex')),
    CONSTRAINT "build_artifacts_flash_offset_check" CHECK ("flash_offset" IS NULL OR "flash_offset" >= 0),
    CONSTRAINT "build_artifacts_size_check"
        CHECK ("size_bytes" = octet_length("content") AND "size_bytes" <= 8388608),
    CONSTRAINT "build_artifacts_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "build_artifacts_build_job_id_name_key" ON "build_artifacts"("build_job_id", "name");

ALTER TABLE "build_artifacts" ADD CONSTRAINT "build_artifacts_build_job_id_fkey"
    FOREIGN KEY ("build_job_id") REFERENCES "build_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "build_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "build_artifacts" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "build_jobs" FROM anon, authenticated;
REVOKE ALL ON TABLE "build_artifacts" FROM anon, authenticated;
