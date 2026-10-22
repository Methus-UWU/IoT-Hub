-- Sign-in history and per-user search history.
--
-- Both tables are private to NestJS: RLS is enabled with no policy and nothing is
-- granted to anon or authenticated, so the Data API cannot read or write them.
-- Rows go with the account through the cascade from users.

CREATE TABLE "login_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "ip_address" TEXT NOT NULL DEFAULT '',
    "user_agent" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "login_events_ip_address_length" CHECK (char_length("ip_address") <= 64),
    CONSTRAINT "login_events_user_agent_length" CHECK (char_length("user_agent") <= 512)
);

CREATE UNIQUE INDEX "login_events_session_id_key" ON "login_events"("session_id");
CREATE INDEX "login_events_user_id_created_at_idx" ON "login_events"("user_id", "created_at" DESC);

ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "search_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,

    CONSTRAINT "search_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "search_history_scope_check" CHECK ("scope" IN ('documents', 'community')),
    CONSTRAINT "search_history_query_length" CHECK (char_length("query") BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX "search_history_user_id_scope_query_key" ON "search_history"("user_id", "scope", "query");
CREATE INDEX "search_history_user_id_scope_created_at_idx" ON "search_history"("user_id", "scope", "created_at" DESC);

ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "login_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "search_history" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "login_events" FROM anon, authenticated;
REVOKE ALL ON TABLE "search_history" FROM anon, authenticated;
