CREATE TABLE IF NOT EXISTS "public"."saved_queries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "query_text" "text" NOT NULL,
    "plan_snapshot" "jsonb",
    "schedule" "text",
    "max_leads" integer DEFAULT 10,
    "auto_approve_threshold" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_run_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."saved_queries" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_saved_queries_brand_active"
    ON "public"."saved_queries" ("brand_id", "is_active");

CREATE INDEX IF NOT EXISTS "idx_saved_queries_client"
    ON "public"."saved_queries" ("client_id");
