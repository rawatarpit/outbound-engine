


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";






CREATE TYPE "public"."enrichment_state" AS ENUM (
    'pending',
    'locked',
    'enriched',
    'failed',
    'dead'
);


ALTER TYPE "public"."enrichment_state" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_api_key_rate_limit"("p_api_key_id" "uuid", "p_limit" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_window timestamptz;
    v_count integer;
BEGIN
    v_window := date_trunc('minute', now());

    INSERT INTO api_rate_limit (api_key_id, window_start, request_count)
    VALUES (p_api_key_id, v_window, 1)
    ON CONFLICT (api_key_id, window_start)
    DO UPDATE SET request_count = api_rate_limit.request_count + 1
    RETURNING request_count INTO v_count;

    IF v_count > p_limit THEN
        RETURN false;
    END IF;

    RETURN true;
END;
$$;


ALTER FUNCTION "public"."check_api_key_rate_limit"("p_api_key_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_client_send_quota"("p_client_id" "uuid") RETURNS TABLE("allowed" boolean, "daily_remaining" integer, "hourly_remaining" integer, "reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_limit integer;
    v_count integer;
    v_hourly_limit integer;
    v_hourly_count integer;
    v_client record;
BEGIN
    SELECT * INTO v_client
    FROM clients
    WHERE id = p_client_id
    FOR UPDATE;

    IF NOT FOUND OR v_client.is_active = false OR v_client.is_paused = true THEN
        RETURN QUERY SELECT false, 0, 0, 'client_inactive';
    END IF;

    v_limit := v_client.daily_send_limit;
    v_hourly_limit := v_client.hourly_send_limit;

    -- Check daily
    INSERT INTO client_daily_send (client_id, send_date, send_count)
    VALUES (p_client_id, CURRENT_DATE, 0)
    ON CONFLICT (client_id, send_date)
    DO UPDATE SET send_count = client_daily_send.send_count;

    SELECT send_count INTO v_count
    FROM client_daily_send
    WHERE client_id = p_client_id AND send_date = CURRENT_DATE;

    IF v_count >= v_limit THEN
        RETURN QUERY SELECT false, 0, 0, 'daily_limit_exceeded';
    END IF;

    -- Check hourly
    INSERT INTO client_hourly_send (client_id, hour_bucket, send_count)
    VALUES (p_client_id, date_trunc('hour', now()), 0)
    ON CONFLICT (client_id, hour_bucket)
    DO UPDATE SET send_count = client_hourly_send.send_count;

    SELECT send_count INTO v_hourly_count
    FROM client_hourly_send
    WHERE client_id = p_client_id AND hour_bucket = date_trunc('hour', now());

    IF v_hourly_count >= v_hourly_limit THEN
        RETURN QUERY SELECT false, v_limit - v_count, 0, 'hourly_limit_exceeded';
    END IF;

    RETURN QUERY SELECT true, v_limit - v_count, v_hourly_limit - v_hourly_count, 'ok';
END;
$$;


ALTER FUNCTION "public"."check_client_send_quota"("p_client_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."discovered_companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "source_id" "uuid",
    "name" "text",
    "website" "text",
    "domain" "text" NOT NULL,
    "raw_payload" "jsonb",
    "processed" boolean DEFAULT false,
    "ingested" boolean DEFAULT false,
    "error" "text",
    "discovered_at" timestamp with time zone DEFAULT "now"(),
    "retry_count" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone,
    "risk" "text",
    "confidence" numeric(4,3),
    "intent_score" numeric(4,3),
    "requires_enrichment" boolean DEFAULT false,
    "enrichment_status" "text" DEFAULT 'pending'::"text",
    "enrichment_attempts" integer DEFAULT 0,
    "last_enrichment_at" timestamp with time zone,
    "enrichment_source" "text",
    "enrichment_reasoning" "jsonb",
    "enrichment_error" "text",
    "dead_letter" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "client_id" "uuid",
    "signal_type" "text",
    "relevance_score" numeric,
    "urgency_score" numeric,
    "fit_reason" "text",
    "summary" "text",
    "source_name" "text",
    "pain_score" numeric,
    "budget_score" numeric,
    "tech_fit_score" numeric,
    "automation_score" numeric,
    "composite_score" numeric,
    "confidence_level" "text",
    CONSTRAINT "discovered_companies_risk_check" CHECK (("risk" = ANY (ARRAY['SAFE_API'::"text", 'MODERATE_PUBLIC'::"text", 'HIGH_SCRAPE'::"text"])))
);


ALTER TABLE "public"."discovered_companies" OWNER TO "postgres";


COMMENT ON COLUMN "public"."discovered_companies"."signal_type" IS 'Signal type: HIRING, FUNDING, LAUNCH, PAIN_POINT, TOOL_SEARCH, PARTNERSHIP, EXPANSION';



COMMENT ON COLUMN "public"."discovered_companies"."relevance_score" IS 'Relevance score 0-100 from opportunity matching';



COMMENT ON COLUMN "public"."discovered_companies"."urgency_score" IS 'Urgency score 0-100 from opportunity matching';



COMMENT ON COLUMN "public"."discovered_companies"."fit_reason" IS 'Reason why this opportunity is a good fit';



COMMENT ON COLUMN "public"."discovered_companies"."summary" IS 'Summary of the discovered content';



COMMENT ON COLUMN "public"."discovered_companies"."source_name" IS 'Source adapter name (reddit, hackernews, indiehackers, remoteok, producthunt)';



CREATE OR REPLACE FUNCTION "public"."claim_companies_for_enrichment"("p_brand_id" "uuid", "p_batch_size" integer) RETURNS SETOF "public"."discovered_companies"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    UPDATE public.discovered_companies
    SET enrichment_status = 'locked', enrichment_attempts = enrichment_attempts + 1, last_enrichment_at = now()
    WHERE id IN (
        SELECT id FROM public.discovered_companies
        WHERE brand_id = p_brand_id
          AND requires_enrichment = true
          AND enrichment_status = 'pending'
          AND enrichment_attempts < 3
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY confidence ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$;


ALTER FUNCTION "public"."claim_companies_for_enrichment"("p_brand_id" "uuid", "p_batch_size" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovered_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "discovered_company_id" "uuid",
    "first_name" "text",
    "last_name" "text",
    "full_name" "text",
    "email" "text",
    "title" "text",
    "processed" boolean DEFAULT false,
    "ingested" boolean DEFAULT false,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "retry_count" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone,
    "risk" "text",
    "confidence" numeric(4,3),
    "intent_score" numeric(4,3),
    "requires_enrichment" boolean DEFAULT false,
    "enrichment_status" "text" DEFAULT 'pending'::"text",
    "enrichment_attempts" integer DEFAULT 0,
    "last_enrichment_at" timestamp with time zone,
    "enrichment_source" "text",
    "enrichment_reasoning" "jsonb",
    "enrichment_error" "text",
    "linkedin_url" "text",
    "raw_payload" "jsonb",
    "dead_letter" boolean DEFAULT false,
    "source_id" "uuid",
    "client_id" "uuid",
    "domain" "text",
    "discovered_at" timestamp with time zone,
    "last_verified_at" timestamp with time zone,
    "verification_status" "text" DEFAULT 'pending'::"text",
    "source_type" "text",
    CONSTRAINT "discovered_contacts_risk_check" CHECK (("risk" = ANY (ARRAY['SAFE_API'::"text", 'MODERATE_PUBLIC'::"text", 'HIGH_SCRAPE'::"text"])))
);


ALTER TABLE "public"."discovered_contacts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_contacts_for_enrichment"("p_brand_id" "uuid", "p_limit" integer) RETURNS SETOF "public"."discovered_contacts"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    UPDATE public.discovered_contacts dc
    SET
        enrichment_status = 'locked',
        enrichment_attempts = dc.enrichment_attempts + 1,
        last_enrichment_at = now()
    WHERE dc.id IN (
        SELECT id
        FROM public.discovered_contacts
        WHERE brand_id = p_brand_id
          AND requires_enrichment = true
          AND enrichment_status = 'pending'
          AND enrichment_attempts < 3
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY confidence ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING dc.*;
END;
$$;


ALTER FUNCTION "public"."claim_contacts_for_enrichment"("p_brand_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_audit_logs"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    DELETE FROM audit_logs
    WHERE created_at < now() - interval '90 days';
END;
$$;


ALTER FUNCTION "public"."cleanup_old_audit_logs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."client_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT client_id 
  FROM client_members 
  WHERE user_id = auth.uid() 
  LIMIT 1;
$$;


ALTER FUNCTION "public"."client_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_client_send_quota"("p_client_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_allowed boolean;
BEGIN
    UPDATE client_daily_send
    SET send_count = send_count + 1
    WHERE client_id = p_client_id AND send_date = CURRENT_DATE
    RETURNING true INTO v_allowed;

    UPDATE client_hourly_send
    SET send_count = send_count + 1
    WHERE client_id = p_client_id AND hour_bucket = date_trunc('hour', now());

    RETURN coalesce(v_allowed, false);
END;
$$;


ALTER FUNCTION "public"."consume_client_send_quota"("p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_send_quota"("p_brand_id" "uuid", "p_domain" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    allowed BOOLEAN := FALSE;
    brand_record RECORD;
BEGIN
    SELECT * INTO brand_record
    FROM brand_profiles
    WHERE id = p_brand_id AND is_active = TRUE;

    IF brand_record IS NULL THEN
        RETURN FALSE;
    END IF;

    IF brand_record.daily_send_limit IS NOT NULL AND brand_record.sent_count >= brand_record.daily_send_limit THEN
        RETURN FALSE;
    END IF;

    IF brand_record.hourly_send_limit IS NOT NULL THEN
        DECLARE
            hourly_sent INT;
        BEGIN
            SELECT COUNT(*)::INT INTO hourly_sent
            FROM sent_messages
            WHERE brand_id = p_brand_id
                AND status = 'sent'
                AND created_at >= NOW() - INTERVAL '1 hour';

            IF hourly_sent >= brand_record.hourly_send_limit THEN
                RETURN FALSE;
            END IF;
        END;
    END IF;

    UPDATE brand_profiles 
    SET sent_count = COALESCE(sent_count, 0) + 1,
        updated_at = NOW()
    WHERE id = p_brand_id;

    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."consume_send_quota"("p_brand_id" "uuid", "p_domain" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."detect_stuck_leads"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
declare
  v_count int;
begin

  update public.leads
  set status = 'error',
      last_error = 'Stuck state detected',
      state_updated_at = now()
  where
    (
      status = 'researching'
      and state_updated_at < now() - interval '1 hour'
    )
    or
    (
      status = 'sending'
      and state_updated_at < now() - interval '10 minutes'
    );

  get diagnostics v_count = row_count;

  insert into public.system_health (check_type, result, metadata)
  values (
    'stuck_leads_check',
    'completed',
    jsonb_build_object('affected_rows', v_count)
  );

  return v_count;

end;
$$;


ALTER FUNCTION "public"."detect_stuck_leads"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fix_client_member_user_id"("p_email" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.client_members
  SET user_id = auth.uid()
  WHERE email = p_email AND user_id IS NULL;
END;
$$;


ALTER FUNCTION "public"."fix_client_member_user_id"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_outreach_from_leads"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Insert into outreach from leads
  INSERT INTO public.outreach (
    brand_id,
    company_id,
    subject,
    body,
    status,
    created_at,
    updated_at
  )
  SELECT 
    l.brand_id,
    l.company_id,
    'Personalized outreach'::text,
    'Draft generated by AI'::text,
    'draft'::text,
    now(),
    now()
  FROM public.leads l
  WHERE l.status = 'qualified'
    AND l.lead_score >= 70
    AND NOT EXISTS (
      SELECT 1 FROM public.outreach o
      WHERE o.brand_id = l.brand_id
        AND o.company_id = l.company_id
    );
END;
$$;


ALTER FUNCTION "public"."generate_outreach_from_leads"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_brand_credentials"("p_brand_id" "uuid") RETURNS TABLE("brand_id" "uuid", "smtp_host" "text", "smtp_port" integer, "smtp_secure" boolean, "smtp_email" "text", "smtp_password" "text", "imap_host" "text", "imap_port" integer, "imap_secure" boolean, "imap_email" "text", "imap_password" "text", "reply_to_email" "text", "daily_send_limit" integer, "hourly_send_limit" integer, "llm_model_override" "text", "llm_temperature" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id,
    b.smtp_host,
    b.smtp_port,
    b.smtp_secure,
    b.smtp_email,
    b.smtp_password,
    b.imap_host,
    b.imap_port,
    b.imap_secure,
    b.imap_email,
    b.imap_password,
    b.reply_to_email,
    b.daily_send_limit,
    b.hourly_send_limit,
    b.llm_model_override,
    b.llm_temperature
  FROM public.brand_profiles b
  WHERE b.id = p_brand_id
    AND b.is_active = true;
END;
$$;


ALTER FUNCTION "public"."get_brand_credentials"("p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_client_credentials"("p_client_id" "uuid") RETURNS TABLE("client_id" "uuid", "smtp_host" "text", "smtp_port" integer, "smtp_secure" boolean, "smtp_email" "text", "smtp_password" "text", "smtp_from_name" "text", "smtp_from_email" "text", "imap_host" "text", "imap_port" integer, "imap_secure" boolean, "imap_email" "text", "imap_password" "text", "email_provider" "text", "provider_api_key" "text", "sending_domain" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        cs.smtp_host,
        cs.smtp_port,
        cs.smtp_secure,
        cs.smtp_email,
        cs.smtp_password,
        cs.smtp_from_name,
        cs.smtp_from_email,
        cs.imap_host,
        cs.imap_port,
        cs.imap_secure,
        cs.imap_email,
        cs.imap_password,
        cs.email_provider,
        cs.provider_api_key,
        cs.sending_domain
    FROM public.clients c
    JOIN public.client_settings cs ON cs.client_id = c.id
    WHERE c.id = p_client_id
      AND c.is_active = true;
END;
$$;


ALTER FUNCTION "public"."get_client_credentials"("p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cors_headers"() RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN jsonb_build_object(
        'Access-Control-Allow-Origin', '*',
        'Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Client-Info',
        'Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'
    );
END;
$$;


ALTER FUNCTION "public"."get_cors_headers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_domain_health"("p_brand_id" "uuid", "p_domain" "text") RETURNS TABLE("bounce_rate" numeric, "complaint_rate" numeric, "daily_sent" bigint, "daily_limit" bigint, "hourly_sent" bigint, "hourly_limit" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE WHEN COALESCE(sd.sent_today, 0) > 0 
         THEN sd.bounce_count::numeric / sd.sent_today 
         ELSE 0 END,
    0::numeric,
    COALESCE(sd.sent_today, 0)::bigint,
    COALESCE(sd.daily_limit, 1000)::bigint,
    0::bigint,
    0::bigint
  FROM sending_domains sd
  WHERE sd.brand_id = p_brand_id AND sd.domain = p_domain AND sd.is_active = true;
END;
$$;


ALTER FUNCTION "public"."get_domain_health"("p_brand_id" "uuid", "p_domain" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_edge_secret"("p_key_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."get_edge_secret"("p_key_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_send_quota_status"("p_brand_id" "uuid", "p_domain" "text") RETURNS TABLE("daily_sent" bigint, "daily_limit" bigint, "hourly_sent" bigint, "hourly_limit" bigint, "bounce_rate" numeric, "complaint_rate" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(dst.send_count, 0)::bigint,
    COALESCE(bp.daily_send_limit, 1000)::bigint,
    COALESCE(dst.send_count, 0)::bigint,
    COALESCE(bp.hourly_send_limit, 100)::bigint,
    CASE WHEN COALESCE(dst.send_count, 0) > 0 
         THEN COALESCE(dst.bounce_count, 0)::numeric / dst.send_count 
         ELSE 0 END,
    0::numeric
  FROM brand_profiles bp
  LEFT JOIN LATERAL (
    SELECT send_count, bounce_count
    FROM send_counters 
    WHERE brand_id = p_brand_id
    ORDER BY created_at DESC
    LIMIT 1
  ) dst ON true
  WHERE bp.id = p_brand_id;
END;
$$;


ALTER FUNCTION "public"."get_send_quota_status"("p_brand_id" "uuid", "p_domain" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_client"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO system_flags (client_id, key, value)
  VALUES 
    (NEW.id, 'automation_enabled', true),
    (NEW.id, 'send_enabled', true),
    (NEW.id, 'imap_enabled', false),
    (NEW.id, 'discovery_enabled', true);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_client"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_discovery_counter"("p_brand_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE public.brand_profiles
    SET discovery_count_today = COALESCE(discovery_count_today, 0) + 1
    WHERE id = p_brand_id;
END;
$$;


ALTER FUNCTION "public"."increment_discovery_counter"("p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_query_approved_count"("p_run_id" "uuid", "p_brand_id" "uuid", "p_domain" "text") RETURNS "void"
    LANGUAGE "sql"
    AS $$
  UPDATE discovery_query_log
  SET approved_count = approved_count + 1
  WHERE run_id = p_run_id
    AND brand_id = p_brand_id
    AND source_domain = p_domain;
$$;


ALTER FUNCTION "public"."increment_query_approved_count"("p_run_id" "uuid", "p_brand_id" "uuid", "p_domain" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_api_usage"("p_client_id" "uuid", "p_api_key_id" "uuid", "p_endpoint" "text", "p_method" "text", "p_status_code" integer, "p_response_time_ms" integer, "p_rate_limited" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    INSERT INTO api_usage_logs (
        client_id,
        api_key_id,
        endpoint,
        method,
        status_code,
        response_time_ms,
        rate_limited
    )
    VALUES (
        p_client_id,
        p_api_key_id,
        p_endpoint,
        p_method,
        p_status_code,
        p_response_time_ms,
        p_rate_limited
    );

    UPDATE client_api_keys
    SET usage_count = usage_count + 1,
        last_used_at = now()
    WHERE id = p_api_key_id;
END;
$$;


ALTER FUNCTION "public"."log_api_usage"("p_client_id" "uuid", "p_api_key_id" "uuid", "p_endpoint" "text", "p_method" "text", "p_status_code" integer, "p_response_time_ms" integer, "p_rate_limited" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit"("p_client_id" "uuid", "p_actor_id" "text", "p_actor_email" "text", "p_action" "text", "p_resource_type" "text", "p_resource_id" "text", "p_changes" "jsonb" DEFAULT '{}'::"jsonb", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_ip_address" "inet" DEFAULT NULL::"inet") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    INSERT INTO audit_logs (
        client_id,
        actor_id,
        actor_email,
        actor_type,
        action,
        resource_type,
        resource_id,
        changes,
        metadata,
        ip_address
    )
    VALUES (
        p_client_id,
        p_actor_id,
        p_actor_email,
        coalesce(p_actor_id, 'system'),
        p_action,
        p_resource_type,
        p_resource_id,
        p_changes,
        p_metadata,
        p_ip_address
    );

    UPDATE clients
    SET last_activity_at = now()
    WHERE id = p_client_id;
END;
$$;


ALTER FUNCTION "public"."log_audit"("p_client_id" "uuid", "p_actor_id" "text", "p_actor_email" "text", "p_action" "text", "p_resource_type" "text", "p_resource_id" "text", "p_changes" "jsonb", "p_metadata" "jsonb", "p_ip_address" "inet") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_discovery_embeddings"("query_embedding" "public"."vector", "match_threshold" double precision DEFAULT 0.65, "match_count" integer DEFAULT 5, "filter_brand_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "brand_id" "uuid", "intent_id" "uuid", "content_type" "text", "content_text" "text", "metadata" "jsonb", "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    de.id,
    de.brand_id,
    de.intent_id,
    de.content_type,
    de.content_text,
    de.metadata,
    1 - (de.embedding <=> query_embedding) AS similarity
  FROM discovery_embeddings de
  WHERE
    (filter_brand_id IS NULL OR de.brand_id = filter_brand_id)
    AND 1 - (de.embedding <=> query_embedding) > match_threshold
  ORDER BY de.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."match_discovery_embeddings"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "filter_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."move_enriched_to_companies"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Insert into companies from discovered_companies where enrichment is successful
  INSERT INTO public.companies (
    brand_id,
    name,
    domain,
    website,
    status,
    source,
    source_id,
    confidence,
    created_at,
    updated_at
  )
  SELECT 
    dc.brand_id,
    dc.name,
    dc.domain,
    dc.website,
    'researching'::text,
    'discovered'::text,
    dc.id::text,
    dc.confidence,
    dc.discovered_at,
    now()
  FROM public.discovered_companies dc
  WHERE dc.enrichment_status IN ('success', 'PARTIAL', 'enriched')
    AND dc.processed = false
    AND NOT EXISTS (
      SELECT 1 FROM public.companies c 
      WHERE c.brand_id = dc.brand_id 
        AND c.domain = dc.domain
    );

  -- Mark as processed in discovered_companies
  UPDATE public.discovered_companies
  SET processed = true,
      enrichment_status = 'moved',
      updated_at = now()
  WHERE enrichment_status IN ('success', 'PARTIAL', 'enriched')
    AND processed = false;

  -- Log activity
  INSERT INTO public.activity_logs (brand_id, activity_type, description)
  SELECT 
    brand_id,
    'company_created'::text,
    'Moved ' || COUNT(*) || ' enriched companies to main table'
  FROM public.companies
  WHERE created_at > now() - interval '5 minutes'
  GROUP BY brand_id;
END;
$$;


ALTER FUNCTION "public"."move_enriched_to_companies"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_bounce"("p_brand_id" "uuid", "p_domain" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  update brand_profiles
  set bounce_count = bounce_count + 1
  where id = p_brand_id;
end;
$$;


ALTER FUNCTION "public"."register_bounce"("p_brand_id" "uuid", "p_domain" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_client_bounce"("p_client_id" "uuid", "p_is_hard" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE client_daily_send
    SET bounce_count = bounce_count + 1
    WHERE client_id = p_client_id AND send_date = CURRENT_DATE;

    IF p_is_hard THEN
        UPDATE clients
        SET auto_paused = true,
            last_activity_at = now()
        WHERE id = p_client_id;
    END IF;
END;
$$;


ALTER FUNCTION "public"."register_client_bounce"("p_client_id" "uuid", "p_is_hard" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_domain_bounce"("p_brand_id" "uuid", "p_domain" "text", "p_is_hard" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE sending_domains
  SET bounce_count = bounce_count + 1,
      last_reset_at = CASE WHEN last_reset_at IS NULL OR last_reset_at < NOW() - INTERVAL '24 hours' THEN NOW() ELSE last_reset_at END
  WHERE brand_id = p_brand_id AND domain = p_domain;

  IF FOUND AND p_is_hard THEN
    UPDATE sending_domains
    SET is_active = false,
        disabled_reason = 'hard_bounce',
        disabled_at = NOW()
    WHERE brand_id = p_brand_id AND domain = p_domain
    AND (bounce_count::numeric / NULLIF(sent_today, 0)) > 0.02;
  END IF;
END;
$$;


ALTER FUNCTION "public"."register_domain_bounce"("p_brand_id" "uuid", "p_domain" "text", "p_is_hard" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_send_quota"("p_brand_id" "uuid", "p_domain" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_daily_ok boolean;
  v_hourly_ok boolean;
BEGIN
  SELECT allowed INTO v_daily_ok 
  FROM rpc_reserve_daily_send(p_brand_id);
  
  SELECT allowed INTO v_hourly_ok 
  FROM rpc_reserve_hourly_send(p_brand_id);
  
  RETURN v_daily_ok AND v_hourly_ok;
END;
$$;


ALTER FUNCTION "public"."reserve_send_quota"("p_brand_id" "uuid", "p_domain" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_discovery_counters"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  update public.brand_profiles
  set discovery_count_today = 0;
end;
$$;


ALTER FUNCTION "public"."reset_discovery_counters"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_activate_scoring_version"("p_version_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE scoring_versions
  SET is_active = false
  WHERE brand_id = (SELECT brand_id FROM scoring_versions WHERE id = p_version_id);
  
  UPDATE scoring_versions
  SET is_active = true
  WHERE id = p_version_id;
END;
$$;


ALTER FUNCTION "public"."rpc_activate_scoring_version"("p_version_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_adjust_scoring_weights"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_config jsonb;
  v_row RECORD;
BEGIN
  FOR v_row IN SELECT brand_id FROM public.scoring_versions WHERE is_active = true LOOP
    SELECT scoring_config INTO v_config 
    FROM public.scoring_versions 
    WHERE brand_id = v_row.brand_id AND is_active = true
    LIMIT 1;

    IF v_config IS NOT NULL THEN
      UPDATE public.scoring_versions 
      SET scoring_config = v_config 
      WHERE brand_id = v_row.brand_id AND is_active = true;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rpc_adjust_scoring_weights"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_backfill_member_user_id"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_member record;
BEGIN
  FOR v_member IN
    SELECT cm.id, cm.email, au.id as auth_id
    FROM public.client_members cm
    JOIN auth.users au ON au.email = cm.email
    WHERE cm.user_id IS NULL
  LOOP
    UPDATE public.client_members
    SET user_id = v_member.auth_id
    WHERE id = v_member.id;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rpc_backfill_member_user_id"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "website" "text",
    "domain" "text",
    "status" "text" DEFAULT 'researching'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "source" "text",
    "source_id" "text",
    "linkedin_url" "text",
    "employee_count" integer,
    "industry" "text",
    "enrichment" "jsonb",
    "confidence_score" numeric,
    "lead_score" numeric,
    "deal_value" numeric,
    "currency" "text" DEFAULT 'INR'::"text",
    "contract_length_months" integer,
    "payment_model" "text",
    "gross_margin" numeric,
    "closed_at" timestamp with time zone,
    "lifetime_value" numeric,
    "brand_id" "uuid" NOT NULL,
    "retry_count" integer DEFAULT 0,
    "next_attempt_at" timestamp with time zone DEFAULT "now"(),
    "last_error" "text",
    "state_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_id" "uuid",
    "notes" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "priority" "text" DEFAULT 'medium'::"text",
    "estimated_value" numeric,
    "enrichment_attempts" integer DEFAULT 0,
    CONSTRAINT "companies_status_check" CHECK (("status" = ANY (ARRAY['researching'::"text", 'researching_processing'::"text", 'qualified'::"text", 'qualified_processing'::"text", 'icp_passed'::"text", 'rejected'::"text", 'draft_ready'::"text", 'draft_ready_processing'::"text", 'contacted'::"text", 'replied'::"text", 'replied_processing'::"text", 'negotiating'::"text", 'negotiating_processing'::"text", 'meeting_booked'::"text", 'closed_won'::"text", 'closed_lost'::"text", 'dead_letter'::"text"])))
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_claim_companies"("p_brand_id" "uuid", "p_status" "text", "p_limit" integer) RETURNS SETOF "public"."companies"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT c.id
    FROM public.companies c
    WHERE
      c.brand_id = p_brand_id
      AND c.status = p_status
      AND (
        c.next_attempt_at IS NULL
        OR c.next_attempt_at <= now()
      )
    ORDER BY
      c.next_attempt_at NULLS FIRST,
      c.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.companies c
  SET
    status = p_status || '_processing',
    updated_at = now(),
    state_updated_at = now()
  FROM candidates
  WHERE c.id = candidates.id
  RETURNING c.*;
END;
$$;


ALTER FUNCTION "public"."rpc_claim_companies"("p_brand_id" "uuid", "p_status" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_claim_discovered_companies"("p_limit" integer) RETURNS SETOF "public"."discovered_companies"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    WITH cte AS (
        SELECT id FROM public.discovered_companies
        WHERE processed = false
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY discovered_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.discovered_companies d
    SET retry_count = d.retry_count
    FROM cte
    WHERE d.id = cte.id
    RETURNING d.*;
END;
$$;


ALTER FUNCTION "public"."rpc_claim_discovered_companies"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_claim_discovered_contacts"("p_limit" integer) RETURNS SETOF "public"."discovered_contacts"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    WITH cte AS (
        SELECT dc.id FROM public.discovered_contacts dc
        WHERE dc.processed = false
          AND (dc.next_attempt_at IS NULL OR dc.next_attempt_at <= now())
        ORDER BY dc.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.discovered_contacts dc2
    SET
        retry_count = dc2.retry_count + 1,
        next_attempt_at = now() + interval '5 minutes'
    FROM cte
    WHERE dc2.id = cte.id
    RETURNING dc2.*;
END;
$$;


ALTER FUNCTION "public"."rpc_claim_discovered_contacts"("p_limit" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brand_discovery_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "config" "jsonb",
    "is_active" boolean DEFAULT true,
    "rate_limit_per_min" integer DEFAULT 10,
    "last_run_at" timestamp with time zone,
    "last_status" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "execution_mode" "text" DEFAULT 'pull'::"text",
    "schedule_cron" "text",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "next_attempt_at" timestamp with time zone,
    "is_running" boolean DEFAULT false NOT NULL,
    "last_error" "text",
    "client_id" "uuid"
);


ALTER TABLE "public"."brand_discovery_sources" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_claim_discovery_sources"("p_limit" integer) RETURNS SETOF "public"."brand_discovery_sources"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    UPDATE brand_discovery_sources s
    SET is_running = true, last_run_at = now()
    WHERE s.id IN (
        SELECT s2.id
        FROM brand_discovery_sources s2
        JOIN brand_profiles b ON b.id = s2.brand_id
        WHERE s2.is_active = true
          AND s2.is_running = false
          AND b.discovery_enabled = true
          AND b.manual_discovery_requested = true
          AND (s2.next_attempt_at IS NULL OR s2.next_attempt_at <= now())
        ORDER BY s2.last_run_at NULLS FIRST, s2.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$;


ALTER FUNCTION "public"."rpc_claim_discovery_sources"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_claim_inbound_message"("p_message_id" "text", "p_brand_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into inbound_message_claims(message_id, brand_id)
  values (p_message_id, p_brand_id)
  on conflict do nothing;

  return found;
end;
$$;


ALTER FUNCTION "public"."rpc_claim_inbound_message"("p_message_id" "text", "p_brand_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."outreach" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "subject" "text",
    "body" "text",
    "status" "text" DEFAULT 'draft'::"text",
    "sent_at" timestamp with time zone,
    "message_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "brand_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "state_updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "outreach_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'draft_processing'::"text", 'approved'::"text", 'sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."outreach" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_claim_outreach_draft"("p_company_id" "uuid") RETURNS "public"."outreach"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_row public.outreach;
BEGIN
  WITH cte AS (
    SELECT id
    FROM public.outreach
    WHERE company_id = p_company_id
      AND status = 'draft'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outreach o
  SET
    status = 'draft_processing',
    updated_at = now(),
    state_updated_at = now()
  FROM cte
  WHERE o.id = cte.id
  RETURNING o.* INTO v_row;

  RETURN v_row;
END;
$$;


ALTER FUNCTION "public"."rpc_claim_outreach_draft"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_close_company"("p_company_id" "uuid", "p_deal_value" numeric, "p_currency" "text", "p_contract_length" integer, "p_payment_model" "text", "p_gross_margin" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_ltv NUMERIC;
BEGIN
    v_ltv := CASE
        WHEN p_payment_model = 'monthly' THEN p_deal_value * p_contract_length
        WHEN p_payment_model = 'annual' THEN p_deal_value * (p_contract_length / 12)
        ELSE p_deal_value
    END;

    UPDATE public.companies
    SET status = 'closed_won', deal_value = p_deal_value, lifetime_value = v_ltv,
        currency = p_currency, contract_length_months = p_contract_length,
        payment_model = p_payment_model, gross_margin = p_gross_margin,
        closed_at = now(), updated_at = now()
    WHERE id = p_company_id;

    UPDATE public.leads
    SET status = 'closed_won', deal_value = v_ltv, closed_at = now(), updated_at = now()
    WHERE company_id = p_company_id;
END;
$$;


ALTER FUNCTION "public"."rpc_close_company"("p_company_id" "uuid", "p_deal_value" numeric, "p_currency" "text", "p_contract_length" integer, "p_payment_model" "text", "p_gross_margin" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_complete_discovered_company"("p_id" "uuid", "p_success" boolean, "p_error" "text" DEFAULT NULL::"text", "p_requires_enrichment" boolean DEFAULT NULL::boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_retry_count INT;
    v_source_id UUID;
    v_payload JSONB;
BEGIN
    SELECT retry_count, source_id, raw_payload
    INTO v_retry_count, v_source_id, v_payload
    FROM public.discovered_companies
    WHERE id = p_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF p_success THEN
        UPDATE public.discovered_companies
        SET
            processed = true,
            retry_count = 0,
            next_attempt_at = NULL,
            error = NULL,
            requires_enrichment = COALESCE(p_requires_enrichment, requires_enrichment)
        WHERE id = p_id;
        RETURN;
    END IF;

    v_retry_count := v_retry_count + 1;

    IF v_retry_count > 5 THEN
        INSERT INTO discovery_dead_letters (entity_type, entity_id, source_id, payload, error)
        VALUES ('company', p_id, v_source_id, v_payload, p_error);
        DELETE FROM public.discovered_companies WHERE id = p_id;
        RETURN;
    END IF;

    UPDATE public.discovered_companies
    SET
        retry_count = v_retry_count,
        next_attempt_at = now() + (interval '5 minutes' * v_retry_count),
        error = p_error
    WHERE id = p_id;
END;
$$;


ALTER FUNCTION "public"."rpc_complete_discovered_company"("p_id" "uuid", "p_success" boolean, "p_error" "text", "p_requires_enrichment" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_complete_discovered_contact"("p_id" "uuid", "p_success" boolean, "p_error" "text" DEFAULT NULL::"text", "p_requires_enrichment" boolean DEFAULT NULL::boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_retry_count INT;
    v_source_id UUID;
    v_payload JSONB;
BEGIN
    SELECT retry_count,
           (SELECT source_id FROM public.discovered_companies dc WHERE dc.id = discovered_company_id),
           raw_payload
    INTO v_retry_count, v_source_id, v_payload
    FROM public.discovered_contacts
    WHERE id = p_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF p_success THEN
        UPDATE public.discovered_contacts
        SET
            processed = true,
            retry_count = 0,
            next_attempt_at = NULL,
            error = NULL,
            requires_enrichment = COALESCE(p_requires_enrichment, requires_enrichment)
        WHERE id = p_id;
        RETURN;
    END IF;

    v_retry_count := v_retry_count + 1;

    IF v_retry_count > 5 THEN
        INSERT INTO discovery_dead_letters (entity_type, entity_id, source_id, payload, error)
        VALUES ('contact', p_id, v_source_id, v_payload, p_error);
        DELETE FROM public.discovered_contacts WHERE id = p_id;
        RETURN;
    END IF;

    UPDATE public.discovered_contacts
    SET
        retry_count = v_retry_count,
        next_attempt_at = now() + (interval '5 minutes' * v_retry_count),
        error = p_error
    WHERE id = p_id;
END;
$$;


ALTER FUNCTION "public"."rpc_complete_discovered_contact"("p_id" "uuid", "p_success" boolean, "p_error" "text", "p_requires_enrichment" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_consume_api_quota"("p_source_id" "uuid", "p_limit" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_window timestamptz;
  v_count int;
begin
  v_window := date_trunc('minute', now());

  insert into public.api_quota_counters(source_id, window_start, request_count)
  values (p_source_id, v_window, 1)
  on conflict (source_id, window_start)
  do update
    set request_count = api_quota_counters.request_count + 1
  returning request_count into v_count;

  if v_count > p_limit then
    return false;
  end if;

  return true;
end;
$$;


ALTER FUNCTION "public"."rpc_consume_api_quota"("p_source_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_create_company_from_lead"("p_lead_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_lead record;
  v_company_id uuid;
BEGIN
  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id;

  IF v_lead.status <> 'icp_passed' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_company_id
  FROM public.companies
  WHERE brand_id = v_lead.brand_id
    AND domain = v_lead.domain
  LIMIT 1;

  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (
      brand_id,
      name,
      domain,
      status,
      source
    )
    VALUES (
      v_lead.brand_id,
      COALESCE(v_lead.domain, 'unknown'),
      v_lead.domain,
      'researching',
      v_lead.source
    )
    RETURNING id INTO v_company_id;
  END IF;

  UPDATE public.leads
  SET company_id = v_company_id
  WHERE id = p_lead_id;

  RETURN v_company_id;
END;
$$;


ALTER FUNCTION "public"."rpc_create_company_from_lead"("p_lead_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_active_brands"() RETURNS TABLE("id" "uuid")
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  select id
  from public.brand_profiles
  where is_active = true;
$$;


ALTER FUNCTION "public"."rpc_get_active_brands"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_imap_brands"() RETURNS TABLE("id" "uuid", "imap_email" "text", "imap_password" "text", "imap_host" "text", "imap_port" integer, "imap_secure" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  select
    id,
    imap_email,
    imap_password,
    imap_host,
    imap_port,
    imap_secure
  from public.brand_profiles
  where is_active = true
    and imap_enabled = true;
$$;


ALTER FUNCTION "public"."rpc_get_imap_brands"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_source_precision"("p_brand_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("source_name" "text", "prec" numeric, "signal_to_noise" numeric, "source_weight" numeric, "total_signals" integer, "last_updated" timestamp with time zone)
    LANGUAGE "sql"
    AS $$
  SELECT source_name, precision, signal_to_noise, source_weight, total_signals, last_updated
  FROM source_precision
  WHERE (p_brand_id IS NULL OR brand_id = p_brand_id)
  ORDER BY precision ASC;
$$;


ALTER FUNCTION "public"."rpc_get_source_precision"("p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_get_validation_report"("p_brand_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql"
    AS $$
  SELECT jsonb_build_object(
    'total_tracked',     count(*),
    'accepted',          count(*) FILTER (WHERE accepted),
    'converted',         count(*) FILTER (WHERE converted),
    'conversion_rate',   CASE WHEN count(*) FILTER (WHERE accepted) > 0
                           THEN round((count(*) FILTER (WHERE converted)::numeric / count(*) FILTER (WHERE accepted)) * 100, 1)
                           ELSE 0 END,
    'avg_confidence',    round(avg(overall_confidence)::numeric, 3),
    'recent',            (SELECT jsonb_agg(item) FROM (
                           SELECT jsonb_build_object(
                             'company', company_name,
                             'confidence', overall_confidence,
                             'accepted', accepted,
                             'converted', converted,
                             'date', created_at
                           ) AS item
                           FROM validation_feedback_loop
                           WHERE brand_id = p_brand_id
                           ORDER BY created_at DESC
                           LIMIT 20
                         ) sub)
  )
  FROM validation_feedback_loop
  WHERE brand_id = p_brand_id;
$$;


ALTER FUNCTION "public"."rpc_get_validation_report"("p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_increment_company_retry"("p_id" "uuid", "p_error" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO dead_letters (brand_id, entity_id, entity_type, failure_stage, error_message, retry_count)
  SELECT brand_id, id, 'company', status, p_error, retry_count
  FROM discovered_companies WHERE id = p_id;
END;
$$;


ALTER FUNCTION "public"."rpc_increment_company_retry"("p_id" "uuid", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_increment_domain_metric"("p_product" "uuid", "p_metric" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    IF p_metric = 'bounce' THEN
        UPDATE brand_profiles 
        SET bounce_count = COALESCE(bounce_count, 0) + 1 
        WHERE id = p_product;
    ELSIF p_metric = 'complaint' THEN
        UPDATE brand_profiles 
        SET complaint_count = COALESCE(complaint_count, 0) + 1 
        WHERE id = p_product;
    ELSIF p_metric = 'sent' THEN
        UPDATE brand_profiles 
        SET sent_count = COALESCE(sent_count, 0) + 1 
        WHERE id = p_product;
    END IF;
END;
$$;


ALTER FUNCTION "public"."rpc_increment_domain_metric"("p_product" "uuid", "p_metric" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_ingest_lead"("p_brand_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_title" "text", "p_company_name" "text", "p_domain" "text", "p_linkedin_url" "text", "p_source" "text", "p_source_id" "text", "p_raw_payload" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_lead_id UUID;
    v_company_id UUID;
BEGIN
    IF p_email IS NULL THEN
        RETURN NULL;
    END IF;

    IF public.rpc_is_blacklisted(p_email, p_domain) THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE brand_id = p_brand_id AND email = p_email
    LIMIT 1;

    IF v_lead_id IS NOT NULL THEN
        RETURN v_lead_id;
    END IF;

    INSERT INTO public.leads (
        brand_id, first_name, last_name, full_name, email, domain,
        title, linkedin_url, source, source_id, raw_payload
    ) VALUES (
        p_brand_id, p_first_name, p_last_name, p_full_name, p_email, p_domain,
        p_title, p_linkedin_url, p_source, p_source_id, p_raw_payload
    )
    RETURNING id INTO v_lead_id;

    IF p_domain IS NOT NULL THEN
        SELECT id INTO v_company_id
        FROM public.companies
        WHERE brand_id = p_brand_id AND domain = p_domain
        LIMIT 1;

        IF v_company_id IS NULL THEN
            INSERT INTO public.companies (brand_id, name, domain, status, source)
            VALUES (p_brand_id, COALESCE(p_company_name, p_domain), p_domain, 'researching', p_source)
            RETURNING id INTO v_company_id;
        END IF;

        INSERT INTO lead_company_map (brand_id, lead_id, company_id)
        VALUES (p_brand_id, v_lead_id, v_company_id)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_lead_id;
END;
$$;


ALTER FUNCTION "public"."rpc_ingest_lead"("p_brand_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_title" "text", "p_company_name" "text", "p_domain" "text", "p_linkedin_url" "text", "p_source" "text", "p_source_id" "text", "p_raw_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_ingest_lead"("p_brand_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_title" "text", "p_company_name" "text", "p_domain" "text", "p_linkedin_url" "text", "p_source" "text", "p_source_id" "text", "p_raw_payload" "jsonb" DEFAULT NULL::"jsonb", "p_client_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_lead_id UUID;
    v_company_id UUID;
BEGIN
    IF p_email IS NULL THEN
        RETURN NULL;
    END IF;

    IF public.rpc_is_blacklisted(p_email, p_domain) THEN
        RETURN NULL;
    END IF;

    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE brand_id = p_brand_id AND email = p_email
    LIMIT 1;

    IF v_lead_id IS NOT NULL THEN
        RETURN v_lead_id;
    END IF;

    INSERT INTO public.leads (
        brand_id, client_id, first_name, last_name, full_name, email, domain,
        title, linkedin_url, source, source_id, raw_payload
    ) VALUES (
        p_brand_id, p_client_id, p_first_name, p_last_name, p_full_name, p_email, p_domain,
        p_title, p_linkedin_url, p_source, p_source_id, p_raw_payload
    )
    RETURNING id INTO v_lead_id;

    IF p_domain IS NOT NULL THEN
        SELECT id INTO v_company_id
        FROM public.companies
        WHERE brand_id = p_brand_id AND domain = p_domain
        LIMIT 1;

        IF v_company_id IS NULL THEN
            INSERT INTO public.companies (brand_id, client_id, name, domain, status, source)
            VALUES (p_brand_id, p_client_id, COALESCE(p_company_name, p_domain), p_domain, 'researching', p_source)
            RETURNING id INTO v_company_id;
        END IF;

        INSERT INTO lead_company_map (brand_id, lead_id, company_id)
        VALUES (p_brand_id, v_lead_id, v_company_id)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_lead_id;
END;
$$;


ALTER FUNCTION "public"."rpc_ingest_lead"("p_brand_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_title" "text", "p_company_name" "text", "p_domain" "text", "p_linkedin_url" "text", "p_source" "text", "p_source_id" "text", "p_raw_payload" "jsonb", "p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_insert_negotiation_draft"("p_company_id" "uuid", "p_draft" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_brand_id uuid;
  v_lead_id uuid;
BEGIN
  SELECT brand_id INTO v_brand_id FROM public.companies WHERE id = p_company_id;
  
  SELECT lead_id INTO v_lead_id 
  FROM public.lead_company_map 
  WHERE company_id = p_company_id 
  LIMIT 1;

  INSERT INTO public.messages (brand_id, lead_id, body, direction, status)
  VALUES (v_brand_id, v_lead_id, p_draft, 'outbound', 'pending');
END;
$$;


ALTER FUNCTION "public"."rpc_insert_negotiation_draft"("p_company_id" "uuid", "p_draft" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_insert_reply"("p_company_id" "uuid", "p_lead_id" "uuid", "p_message_id" "text", "p_body" "text", "p_subject" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    INSERT INTO replies (company_id, message_id, raw_message, brand_id)
    SELECT p_company_id, p_message_id, p_body, brand_id
    FROM companies WHERE id = p_company_id
    ON CONFLICT (message_id) DO NOTHING;
    RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."rpc_insert_reply"("p_company_id" "uuid", "p_lead_id" "uuid", "p_message_id" "text", "p_body" "text", "p_subject" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_is_blacklisted"("p_email" "text", "p_domain" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_exists BOOLEAN;
BEGIN
    SELECT true INTO v_exists
    FROM public.blacklist
    WHERE (email = p_email AND p_email IS NOT NULL)
       OR (domain = p_domain AND p_domain IS NOT NULL)
    LIMIT 1;
    RETURN COALESCE(v_exists, FALSE);
END;
$$;


ALTER FUNCTION "public"."rpc_is_blacklisted"("p_email" "text", "p_domain" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_mark_lead_contacted"("p_lead_id" "uuid", "p_subject" "text", "p_body" "text", "p_message_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    INSERT INTO public.messages (lead_id, message_id, subject, body, direction, created_at)
    VALUES (p_lead_id, p_message_id, p_subject, p_body, 'outbound', now())
    ON CONFLICT (message_id) DO NOTHING;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    UPDATE public.leads
    SET status = 'contacted', contacted_at = now(), updated_at = now()
    WHERE id = p_lead_id;

    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."rpc_mark_lead_contacted"("p_lead_id" "uuid", "p_subject" "text", "p_body" "text", "p_message_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_recalibrate_lead_confidence"("p_lead_id" "uuid", "p_new_confidence" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.leads
  SET confidence_score = p_new_confidence, last_outcome_at = now()
  WHERE id = p_lead_id;
END;
$$;


ALTER FUNCTION "public"."rpc_recalibrate_lead_confidence"("p_lead_id" "uuid", "p_new_confidence" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reclaim_stale_companies"("p_brand_id" "uuid", "p_processing_status" "text", "p_timeout_seconds" integer) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.companies
  SET
    status = replace(p_processing_status, '_processing', ''),
    updated_at = now(),
    state_updated_at = now()
  WHERE
    brand_id = p_brand_id
    AND status = p_processing_status
    AND state_updated_at < now() - make_interval(secs => p_timeout_seconds);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."rpc_reclaim_stale_companies"("p_brand_id" "uuid", "p_processing_status" "text", "p_timeout_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_record_source_precision"("p_source_name" "text", "p_brand_id" "uuid", "p_signal_type" "text", "p_end_client" boolean, "p_false_positive" boolean DEFAULT false) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO source_precision (source_name, brand_id, total_signals, end_client_signals, provider_signals, false_positives, last_updated)
  VALUES (
    p_source_name, p_brand_id, 1,
    CASE WHEN p_end_client THEN 1 ELSE 0 END,
    CASE WHEN NOT p_end_client AND NOT p_false_positive THEN 1 ELSE 0 END,
    CASE WHEN p_false_positive THEN 1 ELSE 0 END,
    now()
  )
  ON CONFLICT (source_name, brand_id) DO UPDATE SET
    total_signals        = source_precision.total_signals + 1,
    end_client_signals   = source_precision.end_client_signals + CASE WHEN p_end_client THEN 1 ELSE 0 END,
    provider_signals     = source_precision.provider_signals + CASE WHEN NOT p_end_client AND NOT p_false_positive THEN 1 ELSE 0 END,
    false_positives      = source_precision.false_positives + CASE WHEN p_false_positive THEN 1 ELSE 0 END,
    precision            = (source_precision.end_client_signals + CASE WHEN p_end_client THEN 1 ELSE 0 END)::numeric /
                           (source_precision.total_signals + 1),
    signal_to_noise      = (source_precision.end_client_signals + CASE WHEN p_end_client THEN 1 ELSE 0 END + 1)::numeric /
                           (GREATEST(source_precision.provider_signals + source_precision.false_positives, 1)),
    source_weight        = LEAST(2.0, GREATEST(0.1, 
                           (source_precision.end_client_signals + CASE WHEN p_end_client THEN 1 ELSE 0 END)::numeric /
                           (source_precision.total_signals + 1) * 2)),
    last_updated         = now();
END;
$$;


ALTER FUNCTION "public"."rpc_record_source_precision"("p_source_name" "text", "p_brand_id" "uuid", "p_signal_type" "text", "p_end_client" boolean, "p_false_positive" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_record_validation_outcome"("p_brand_id" "uuid", "p_company_name" "text", "p_domain" "text", "p_overall_confidence" numeric, "p_accepted" boolean, "p_converted" boolean DEFAULT false, "p_dimension_scores" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO validation_feedback_loop (brand_id, company_name, domain, overall_confidence, accepted, converted, dimension_scores)
  VALUES (p_brand_id, p_company_name, p_domain, p_overall_confidence, p_accepted, p_converted, p_dimension_scores);
END;
$$;


ALTER FUNCTION "public"."rpc_record_validation_outcome"("p_brand_id" "uuid", "p_company_name" "text", "p_domain" "text", "p_overall_confidence" numeric, "p_accepted" boolean, "p_converted" boolean, "p_dimension_scores" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_register_failure"("p_entity_type" "text", "p_entity_id" "uuid", "p_error" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_retry INT;
    v_delay INTERVAL;
BEGIN
    IF p_entity_type = 'company' THEN
        UPDATE public.companies
        SET retry_count = retry_count + 1, last_error = p_error
        WHERE id = p_entity_id
        RETURNING retry_count INTO v_retry;

        IF v_retry >= 5 THEN
            INSERT INTO dead_letter_queue (entity_type, entity_id, reason)
            VALUES ('company', p_entity_id, p_error);
            RETURN FALSE;
        END IF;

        v_delay := (POWER(2, v_retry) || ' minutes')::interval;
        UPDATE public.companies SET next_attempt_at = now() + v_delay WHERE id = p_entity_id;
        RETURN TRUE;

    ELSIF p_entity_type = 'lead' THEN
        UPDATE public.leads
        SET retry_count = retry_count + 1, last_error = p_error
        WHERE id = p_entity_id
        RETURNING retry_count INTO v_retry;

        IF v_retry >= 5 THEN
            INSERT INTO dead_letter_queue (entity_type, entity_id, reason)
            VALUES ('lead', p_entity_id, p_error);
            RETURN FALSE;
        END IF;

        v_delay := (POWER(2, v_retry) || ' minutes')::interval;
        UPDATE public.leads SET next_attempt_at = now() + v_delay WHERE id = p_entity_id;
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."rpc_register_failure"("p_entity_type" "text", "p_entity_id" "uuid", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_release_discovery_source"("p_source_id" "uuid", "p_success" boolean, "p_error" "text" DEFAULT NULL::"text", "p_companies" integer DEFAULT 0, "p_contacts" integer DEFAULT 0, "p_duration_ms" integer DEFAULT NULL::integer) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_brand_id UUID;
BEGIN
    SELECT brand_id INTO v_brand_id
    FROM brand_discovery_sources
    WHERE id = p_source_id;

    UPDATE brand_discovery_sources
    SET
        is_running = false,
        last_status = CASE WHEN p_success THEN 'success' ELSE 'failed' END,
        last_error = p_error,
        retry_count = CASE WHEN p_success THEN 0 ELSE retry_count + 1 END,
        next_attempt_at = CASE
            WHEN p_success THEN NULL
            ELSE now() + (interval '1 minute' * (retry_count + 1))
        END
    WHERE id = p_source_id;

    IF p_success AND v_brand_id IS NOT NULL THEN
        UPDATE brand_profiles
        SET manual_discovery_requested = false
        WHERE id = v_brand_id;
    END IF;

    INSERT INTO discovery_metrics (
        source_id,
        companies_discovered,
        contacts_discovered,
        duration_ms,
        success,
        error
    ) VALUES (
        p_source_id,
        p_companies,
        p_contacts,
        p_duration_ms,
        p_success,
        p_error
    );
END;
$$;


ALTER FUNCTION "public"."rpc_release_discovery_source"("p_source_id" "uuid", "p_success" boolean, "p_error" "text", "p_companies" integer, "p_contacts" integer, "p_duration_ms" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_request_manual_discovery"("p_brand_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE brand_profiles
    SET manual_discovery_requested = true
    WHERE id = p_brand_id AND discovery_enabled = true;
END;
$$;


ALTER FUNCTION "public"."rpc_request_manual_discovery"("p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reserve_daily_send"("p_brand_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_limit integer;
  v_current integer;
BEGIN

  SELECT daily_send_limit
  INTO v_limit
  FROM public.brand_profiles
  WHERE id = p_brand_id;

  INSERT INTO public.daily_send_tracker (
    brand_id,
    send_date,
    send_count
  )
  VALUES (
    p_brand_id,
    current_date,
    0
  )
  ON CONFLICT (brand_id, send_date)
  DO NOTHING;

  SELECT send_count
  INTO v_current
  FROM public.daily_send_tracker
  WHERE brand_id = p_brand_id
    AND send_date = current_date
  FOR UPDATE;

  IF v_current >= v_limit THEN
    RETURN false;
  END IF;

  UPDATE public.daily_send_tracker
  SET send_count = send_count + 1
  WHERE brand_id = p_brand_id
    AND send_date = current_date;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."rpc_reserve_daily_send"("p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_reserve_hourly_send"("p_brand_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  current_bucket timestamptz := date_trunc('hour', now());
  current_count integer;
  hourly_limit integer;
BEGIN

  SELECT hourly_send_limit
  INTO hourly_limit
  FROM public.brand_profiles
  WHERE id = p_brand_id
    AND send_enabled = true;

  IF hourly_limit IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.send_counters (
    brand_id,
    counter_type,
    bucket_start,
    send_count
  )
  VALUES (
    p_brand_id,
    'hourly',
    current_bucket,
    0
  )
  ON CONFLICT (brand_id, counter_type, bucket_start)
  DO NOTHING;

  UPDATE public.send_counters
  SET send_count = send_count + 1
  WHERE brand_id = p_brand_id
    AND counter_type = 'hourly'
    AND bucket_start = current_bucket
    AND send_count < hourly_limit
  RETURNING send_count INTO current_count;

  RETURN current_count IS NOT NULL;
END;
$$;


ALTER FUNCTION "public"."rpc_reserve_hourly_send"("p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_score_lead"("p_lead_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$DECLARE
  v_lead record;
  v_config jsonb;
  v_version_id uuid;
  v_score numeric := 0;
  v_threshold numeric := 0;
  v_breakdown jsonb := '{}'::jsonb;
  v_key text;
  v_value jsonb;
BEGIN

  -- 1️⃣ Load lead
  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 2️⃣ Load active scoring config for brand
  SELECT scoring_config, id
  INTO v_config, v_version_id
  FROM public.scoring_versions
  WHERE brand_id = v_lead.brand_id
    AND is_active = true
  LIMIT 1;

  IF v_config IS NULL THEN
    RETURN;
  END IF;

  v_threshold := COALESCE((v_config->>'threshold')::numeric, 0);

  -- =====================================================
  -- TITLE MATCH SCORING
  -- =====================================================

  IF v_config->'weights' ? 'title_contains'
     AND v_lead.title IS NOT NULL
  THEN
    FOR v_key, v_value IN
      SELECT key, value
      FROM jsonb_each(v_config->'weights'->'title_contains')
    LOOP
      IF lower(v_lead.title) LIKE '%' || lower(v_key) || '%' THEN
        v_score := v_score + (v_value::numeric);
        v_breakdown := v_breakdown || jsonb_build_object(v_key, v_value);
      END IF;
    END LOOP;
  END IF;

  -- =====================================================
  -- GEO MATCH (DOMAIN BASED)
  -- =====================================================

  IF v_config->'weights' ? 'geo_contains'
     AND v_lead.domain IS NOT NULL
  THEN
    FOR v_key, v_value IN
      SELECT key, value
      FROM jsonb_each(v_config->'weights'->'geo_contains')
    LOOP
      IF lower(v_lead.domain) LIKE '%' || lower(v_key) || '%' THEN
        v_score := v_score + (v_value::numeric);
        v_breakdown := v_breakdown || jsonb_build_object(v_key, v_value);
      END IF;
    END LOOP;
  END IF;

  -- =====================================================
  -- FINAL DECISION
  -- =====================================================

  UPDATE public.leads
  SET lead_score = v_score,
      score_breakdown = v_breakdown,
      scoring_version_id = v_version_id,
      status = CASE
        WHEN v_score >= v_threshold THEN 'icp_passed'
        ELSE 'filtered_out'
      END,
      updated_at = now()
  WHERE id = p_lead_id;

END;$$;


ALTER FUNCTION "public"."rpc_score_lead"("p_lead_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_brand_deliverability"("p_brand_id" "uuid", "p_score" numeric, "p_auto_pause" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  update public.brand_profiles
  set
    deliverability_score = p_score,
    auto_paused = p_auto_pause,
    last_deliverability_check = now()
  where id = p_brand_id;
end;
$$;


ALTER FUNCTION "public"."rpc_update_brand_deliverability"("p_brand_id" "uuid", "p_score" numeric, "p_auto_pause" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_company_status"("p_brand_id" "uuid", "p_company_id" "uuid", "p_expected_status" "text", "p_new_status" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_updated boolean;
BEGIN
  UPDATE public.companies
  SET status = p_new_status,
      updated_at = now()
  WHERE id = p_company_id
    AND brand_id = p_brand_id
    AND status = p_expected_status;

  v_updated := FOUND;
  RETURN v_updated;
END;
$$;


ALTER FUNCTION "public"."rpc_update_company_status"("p_brand_id" "uuid", "p_company_id" "uuid", "p_expected_status" "text", "p_new_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_lead_status"("p_lead_id" "uuid", "p_new_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.leads
  SET status = p_new_status,
      updated_at = now()
  WHERE id = p_lead_id;
END;
$$;


ALTER FUNCTION "public"."rpc_update_lead_status"("p_lead_id" "uuid", "p_new_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_signal_performance_for_company"("p_company_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_lead record;
  v_key text;
  v_value jsonb;
  v_ltv numeric;
BEGIN

  SELECT lifetime_value INTO v_ltv
  FROM public.companies
  WHERE id = p_company_id;

  IF v_ltv IS NULL THEN
    RETURN;
  END IF;

  FOR v_lead IN
    SELECT *
    FROM public.leads
    WHERE company_id = p_company_id
      AND status = 'closed_won'
  LOOP

    FOR v_key, v_value IN
      SELECT key, value
      FROM jsonb_each(v_lead.score_breakdown)
    LOOP

      INSERT INTO public.signal_performance (
        brand_id,
        signal,
        total_leads,
        total_closed,
        total_revenue
      )
      VALUES (
        v_lead.brand_id,
        v_key,
        1,
        1,
        v_ltv
      )
      ON CONFLICT (brand_id, signal)
      DO UPDATE SET
        total_leads = signal_performance.total_leads + 1,
        total_closed = signal_performance.total_closed + 1,
        total_revenue = signal_performance.total_revenue + v_ltv;

    END LOOP;

  END LOOP;

END;
$$;


ALTER FUNCTION "public"."rpc_update_signal_performance_for_company"("p_company_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpc_update_signal_source_performance"("p_brand_id" "uuid", "p_source_id" "uuid", "p_send_delta" integer DEFAULT 0, "p_reply_delta" integer DEFAULT 0, "p_bounce_delta" integer DEFAULT 0) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO signal_source_performance (source_id, brand_id, sends, replies, bounces, last_updated)
  VALUES (p_source_id, p_brand_id, p_send_delta, p_reply_delta, p_bounce_delta, now())
  ON CONFLICT (source_id, brand_id) DO UPDATE SET
    sends = signal_source_performance.sends + p_send_delta,
    replies = signal_source_performance.replies + p_reply_delta,
    bounces = signal_source_performance.bounces + p_bounce_delta,
    last_updated = now();
END;
$$;


ALTER FUNCTION "public"."rpc_update_signal_source_performance"("p_brand_id" "uuid", "p_source_id" "uuid", "p_send_delta" integer, "p_reply_delta" integer, "p_bounce_delta" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."schedule_retry"("p_lead_id" "uuid", "p_error" "text", "p_max_attempts" integer DEFAULT 5) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_retry int;
  v_delay interval;
begin
  select retry_count into v_retry
  from public.leads
  where id = p_lead_id
  for update;

  if v_retry is null then
    raise exception 'Lead not found';
  end if;

  v_retry := v_retry + 1;

  -- Exponential backoff
  if v_retry = 1 then
    v_delay := interval '5 minutes';
  elsif v_retry = 2 then
    v_delay := interval '15 minutes';
  elsif v_retry = 3 then
    v_delay := interval '1 hour';
  elsif v_retry = 4 then
    v_delay := interval '6 hours';
  else
    v_delay := interval '24 hours';
  end if;

  if v_retry >= p_max_attempts then
    -- Move to dead letter
    insert into public.dead_letters (
      brand_id,
      entity_type,
      entity_id,
      failure_stage,
      error_message,
      retry_count,
      last_attempt_at
    )
    select brand_id,
           'lead',
           id,
           status,
           p_error,
           v_retry,
           now()
    from public.leads
    where id = p_lead_id;

    update public.leads
    set status = 'error',
        last_error = p_error,
        retry_count = v_retry,
        state_updated_at = now()
    where id = p_lead_id;

  else
    update public.leads
    set retry_count = v_retry,
        next_retry_at = now() + v_delay,
        last_error = p_error,
        state_updated_at = now()
    where id = p_lead_id;
  end if;

end;
$$;


ALTER FUNCTION "public"."schedule_retry"("p_lead_id" "uuid", "p_error" "text", "p_max_attempts" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."score_leads_after_enrichment"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Insert into leads from companies that are ready
  INSERT INTO public.leads (
    brand_id,
    first_name,
    last_name,
    full_name,
    email,
    domain,
    title,
    linkedin_url,
    source,
    source_id,
    status,
    created_at,
    updated_at
  )
  SELECT 
    c.brand_id,
    NULL,
    NULL,
    c.name,
    NULL,
    c.domain,
    NULL,
    c.linkedin_url,
    c.source,
    c.id::text,
    'new'::text,
    now(),
    now()
  FROM public.companies c
  WHERE c.status = 'researching'
    AND c.lead_score IS NULL
    AND EXISTS (
      SELECT 1 FROM public.discovered_companies dc
      WHERE dc.brand_id = c.brand_id
        AND dc.domain = c.domain
        AND dc.relevance_score >= 70
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.brand_id = c.brand_id
        AND l.domain = c.domain
    );

  -- Update company status
  UPDATE public.companies
  SET status = 'qualified',
      updated_at = now()
  WHERE id IN (
    SELECT c.id FROM public.companies c
    WHERE c.status = 'researching'
    AND EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.brand_id = c.brand_id
        AND l.domain = c.domain
    )
  );
END;
$$;


ALTER FUNCTION "public"."score_leads_after_enrichment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_discovered_companies_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_discovered_companies_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_create_company_from_lead"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_company_id uuid;
BEGIN

  -- Only trigger when status changes to icp_passed
  IF NEW.status = 'icp_passed'
     AND (OLD.status IS DISTINCT FROM 'icp_passed')
  THEN

    -- Skip if no domain
    IF NEW.domain IS NULL THEN
      RETURN NEW;
    END IF;

    -- Check existing company (brand-scoped)
    SELECT id INTO v_company_id
    FROM public.companies
    WHERE brand_id = NEW.brand_id
      AND domain = NEW.domain
    LIMIT 1;

    -- Create company if not exists
    IF v_company_id IS NULL THEN
      INSERT INTO public.companies (
        brand_id,
        name,
        domain,
        status,
        source,
        source_id
      )
      VALUES (
        NEW.brand_id,
        COALESCE(NEW.domain, 'unknown'),
        NEW.domain,
        'researching',
        NEW.source,
        NEW.source_id
      )
      RETURNING id INTO v_company_id;
    END IF;

    -- Link lead to company
    UPDATE public.leads
    SET company_id = v_company_id
    WHERE id = NEW.id;

    INSERT INTO public.lead_company_map (
      brand_id,
      lead_id,
      company_id
    )
    VALUES (
      NEW.brand_id,
      NEW.id,
      v_company_id
    )
    ON CONFLICT DO NOTHING;

  END IF;

  RETURN NEW;

END;
$$;


ALTER FUNCTION "public"."trigger_create_company_from_lead"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_company_enrichment"("p_company_id" "uuid", "p_status" "text", "p_enrichment_data" "jsonb" DEFAULT NULL::"jsonb", "p_error" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE discovered_companies
    SET 
        enrichment_status = LOWER(p_status),
        enrichment_attempts = enrichment_attempts + 1,
        last_enrichment_at = NOW(),
        enrichment_data = COALESCE(p_enrichment_data, enrichment_data),
        enrichment_error = p_error,
        requires_enrichment = CASE 
            WHEN LOWER(p_status) IN ('success', 'enriched') THEN false 
            ELSE requires_enrichment 
        END
    WHERE id = p_company_id;
END;
$$;


ALTER FUNCTION "public"."update_company_enrichment"("p_company_id" "uuid", "p_status" "text", "p_enrichment_data" "jsonb", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_company_enrichment"("p_company_id" "uuid", "p_confidence" numeric, "p_company_name" "text", "p_website" "text", "p_domain" "text", "p_status" "text", "p_error" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.discovered_companies
    SET
        name = COALESCE(p_company_name, name),
        website = COALESCE(p_website, website),
        domain = COALESCE(p_domain, domain),
        confidence = p_confidence,
        enrichment_status = p_status,
        enrichment_error = p_error,
        requires_enrichment =
            CASE
                WHEN p_status IN ('SUCCESS', 'SKIPPED') THEN false
                WHEN enrichment_attempts >= 3 THEN false
                ELSE true
            END,
        next_attempt_at =
            CASE
                WHEN p_status = 'FAILED'
                THEN now() + interval '15 minutes'
                ELSE NULL
            END,
        updated_at = now()
    WHERE id = p_company_id;
END;
$$;


ALTER FUNCTION "public"."update_company_enrichment"("p_company_id" "uuid", "p_confidence" numeric, "p_company_name" "text", "p_website" "text", "p_domain" "text", "p_status" "text", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_contact_enrichment"("p_contact_id" "uuid", "p_confidence" numeric, "p_email" "text" DEFAULT NULL::"text", "p_title" "text" DEFAULT NULL::"text", "p_linkedin_url" "text" DEFAULT NULL::"text", "p_intent_score" numeric DEFAULT NULL::numeric, "p_status" "text" DEFAULT NULL::"text", "p_error" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE discovered_contacts
    SET 
        confidence = p_confidence,
        email = COALESCE(p_email, email),
        title = COALESCE(p_title, title),
        linkedin_url = COALESCE(p_linkedin_url, linkedin_url),
        intent_score = COALESCE(p_intent_score, intent_score),
        enrichment_status = CASE 
            WHEN p_status IS NOT NULL THEN LOWER(p_status)
            ELSE enrichment_status 
        END,
        enrichment_attempts = enrichment_attempts + 1,
        last_enrichment_at = NOW(),
        enrichment_error = p_error,
        requires_enrichment = CASE 
            WHEN LOWER(p_status) IN ('success', 'enriched') THEN false 
            ELSE requires_enrichment 
        END
    WHERE id = p_contact_id;
END;
$$;


ALTER FUNCTION "public"."update_contact_enrichment"("p_contact_id" "uuid", "p_confidence" numeric, "p_email" "text", "p_title" "text", "p_linkedin_url" "text", "p_intent_score" numeric, "p_status" "text", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_contact_enrichment"("p_contact_id" "uuid", "p_email" "text", "p_confidence" numeric, "p_status" "text", "p_requires_enrichment" boolean, "p_source" "text", "p_reasoning" "jsonb", "p_error" "text", "p_intent_score" numeric, "p_linkedin_url" "text", "p_title" "text", "p_attempts" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.discovered_contacts
    SET
        email = p_email,
        confidence = p_confidence,
        enrichment_status = p_status,
        requires_enrichment = p_requires_enrichment,
        enrichment_source = p_source,
        enrichment_reasoning = p_reasoning,
        enrichment_error = p_error,
        intent_score = p_intent_score,
        linkedin_url = p_linkedin_url,
        title = p_title,
        enrichment_attempts = p_attempts,
        updated_at = now()
    WHERE id = p_contact_id;
END;
$$;


ALTER FUNCTION "public"."update_contact_enrichment"("p_contact_id" "uuid", "p_email" "text", "p_confidence" numeric, "p_status" "text", "p_requires_enrichment" boolean, "p_source" "text", "p_reasoning" "jsonb", "p_error" "text", "p_intent_score" numeric, "p_linkedin_url" "text", "p_title" "text", "p_attempts" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "brand_id" "uuid",
    "lead_id" "uuid",
    "company_id" "uuid",
    "user_id" "uuid",
    "activity_type" "text" NOT NULL,
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."activity_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."adapter_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "adapter_name" "text" NOT NULL,
    "display_name" "text",
    "supported_signals" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "rate_limit_per_min" integer DEFAULT 30 NOT NULL,
    "reliability" numeric(3,2) DEFAULT 0.50 NOT NULL,
    "timeout_ms" integer DEFAULT 30000 NOT NULL,
    "requires_auth" boolean DEFAULT false NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."adapter_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_quota_counters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_id" "uuid" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "request_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."api_quota_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_rate_limit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "api_key_id" "uuid" NOT NULL,
    "window_start" timestamp with time zone DEFAULT "date_trunc"('minute'::"text", "now"()) NOT NULL,
    "request_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."api_rate_limit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_usage_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "api_key_id" "uuid",
    "endpoint" "text" NOT NULL,
    "method" "text" NOT NULL,
    "status_code" integer,
    "response_time_ms" integer,
    "rate_limited" boolean DEFAULT false,
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."api_usage_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "actor_id" "text",
    "actor_email" "text",
    "actor_type" "text" DEFAULT 'system'::"text",
    "action" "text" NOT NULL,
    "resource_type" "text",
    "resource_id" "text",
    "changes" "jsonb",
    "metadata" "jsonb",
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blacklist" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "domain" "text",
    "email" "public"."citext",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."blacklist" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brand_intents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "intent" "text" NOT NULL,
    "signals" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "priority" integer DEFAULT 1,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "seeker_indicator_weight" numeric DEFAULT 1.0,
    "negation_patterns" "jsonb",
    CONSTRAINT "brand_intents_priority_check" CHECK ((("priority" >= 1) AND ("priority" <= 10)))
);


ALTER TABLE "public"."brand_intents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brand_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "product" "text" NOT NULL,
    "brand_name" "text" NOT NULL,
    "positioning" "text",
    "core_offer" "text",
    "tone" "text",
    "audience" "text",
    "objection_guidelines" "text",
    "negotiation_style" "text",
    "smtp_host" "text",
    "smtp_port" integer,
    "smtp_secure" boolean DEFAULT false,
    "smtp_email" "text",
    "smtp_password" "text",
    "imap_host" "text",
    "imap_port" integer,
    "imap_secure" boolean DEFAULT false,
    "imap_email" "text",
    "imap_password" "text",
    "provider" "text" DEFAULT 'smtp'::"text",
    "provider_api_key" "text",
    "sending_domain" "text",
    "webhook_secret" "text",
    "transport_mode" "text" DEFAULT 'mailbox'::"text",
    "reply_to_email" "text",
    "signature_block" "text",
    "daily_send_limit" integer,
    "hourly_send_limit" integer,
    "llm_model_override" "text",
    "llm_temperature" numeric,
    "is_active" boolean DEFAULT true,
    "is_paused" boolean DEFAULT false,
    "auto_paused" boolean DEFAULT false,
    "imap_enabled" boolean DEFAULT false,
    "send_enabled" boolean DEFAULT true,
    "bounce_count" integer DEFAULT 0,
    "sent_count" integer DEFAULT 0,
    "complaint_count" integer DEFAULT 0,
    "deliverability_score" numeric,
    "last_deliverability_check" timestamp with time zone,
    "discovery_enabled" boolean DEFAULT false,
    "discovery_daily_limit" integer DEFAULT 100,
    "discovery_count_today" integer DEFAULT 0,
    "last_discovery_date" "date",
    "outbound_enabled" boolean DEFAULT false,
    "manual_discovery_requested" boolean DEFAULT false,
    "qualification_threshold" integer DEFAULT 60,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "email_signature" "text",
    "auto_reply_enabled" boolean DEFAULT false,
    "warmup_enabled" boolean DEFAULT false,
    "discovery_api_key" "text",
    "scraper_api_key" "text",
    "apify_api_key" "text",
    "cold_start_mode" boolean DEFAULT true,
    CONSTRAINT "brand_profiles_provider_check" CHECK (("provider" = ANY (ARRAY['smtp'::"text", 'resend'::"text", 'ses'::"text"]))),
    CONSTRAINT "brand_profiles_transport_mode_check" CHECK (("transport_mode" = ANY (ARRAY['mailbox'::"text", 'api'::"text"])))
);


ALTER TABLE "public"."brand_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."brand_profiles"."discovery_api_key" IS 'API key for discovery services (Zenserp, Serper, etc.)';



CREATE TABLE IF NOT EXISTS "public"."brand_profiles_backup" (
    "id" "uuid",
    "product" "text",
    "brand_name" "text",
    "positioning" "text",
    "core_offer" "text",
    "tone" "text",
    "audience" "text",
    "objection_guidelines" "text",
    "negotiation_style" "text",
    "smtp_host" "text",
    "smtp_port" integer,
    "smtp_secure" boolean,
    "smtp_email" "text",
    "smtp_password" "text",
    "imap_host" "text",
    "imap_port" integer,
    "imap_secure" boolean,
    "imap_email" "text",
    "imap_password" "text",
    "reply_to_email" "text",
    "signature_block" "text",
    "daily_send_limit" integer,
    "hourly_send_limit" integer,
    "llm_model_override" "text",
    "llm_temperature" numeric,
    "is_active" boolean,
    "created_at" timestamp with time zone,
    "imap_enabled" boolean,
    "send_enabled" boolean,
    "bounce_count" integer,
    "sent_count" integer,
    "complaint_count" integer,
    "is_paused" boolean,
    "deliverability_score" numeric,
    "auto_paused" boolean,
    "last_deliverability_check" timestamp with time zone,
    "provider" "text",
    "provider_api_key" "text",
    "sending_domain" "text",
    "webhook_secret" "text",
    "transport_mode" "text",
    "execution_state" "text",
    "discovery_enabled" boolean,
    "outbound_enabled" boolean,
    "manual_discovery_requested" boolean,
    "client_id" "uuid",
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."brand_profiles_backup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_analytics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid",
    "campaign_name" "text",
    "date" "date" NOT NULL,
    "sent_count" integer DEFAULT 0,
    "delivered_count" integer DEFAULT 0,
    "opened_count" integer DEFAULT 0,
    "clicked_count" integer DEFAULT 0,
    "replied_count" integer DEFAULT 0,
    "bounced_count" integer DEFAULT 0,
    "unsubscribed_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."campaign_analytics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."circuit_breaker_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "text" NOT NULL,
    "failure_count" integer DEFAULT 0,
    "last_failure_at" timestamp with time zone,
    "last_failure_reason" "text",
    "state" "text" DEFAULT 'closed'::"text" NOT NULL,
    "reset_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "brand_id" "uuid",
    CONSTRAINT "circuit_breaker_state_state_check" CHECK (("state" = ANY (ARRAY['closed'::"text", 'open'::"text", 'half_open'::"text"])))
);


ALTER TABLE "public"."circuit_breaker_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "key_hash" "text" NOT NULL,
    "rate_limit_per_minute" integer DEFAULT 60 NOT NULL,
    "rate_limit_per_day" integer DEFAULT 1000 NOT NULL,
    "last_used_at" timestamp with time zone,
    "usage_count" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_daily_send" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "send_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "send_count" integer DEFAULT 0 NOT NULL,
    "bounce_count" integer DEFAULT 0 NOT NULL,
    "complaint_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."client_daily_send" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_hourly_send" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "hour_bucket" timestamp with time zone DEFAULT "date_trunc"('hour'::"text", "now"()) NOT NULL,
    "send_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."client_hourly_send" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "email" "text" NOT NULL,
    "name" "text",
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "password_hash" "text",
    "invite_token" "text",
    "invited_at" timestamp with time zone,
    "joined_at" timestamp with time zone,
    "last_login_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    CONSTRAINT "client_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."client_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "smtp_host" "text",
    "smtp_port" integer,
    "smtp_secure" boolean DEFAULT false,
    "smtp_email" "text",
    "smtp_password" "text",
    "smtp_from_name" "text",
    "smtp_from_email" "text",
    "imap_host" "text",
    "imap_port" integer,
    "imap_secure" boolean DEFAULT true,
    "imap_email" "text",
    "imap_password" "text",
    "imap_enabled" boolean DEFAULT false,
    "email_provider" "text" DEFAULT 'smtp'::"text",
    "provider_api_key" "text",
    "sending_domain" "text",
    "webhook_secret" "text",
    "llm_provider" "text" DEFAULT 'ollama'::"text",
    "llm_model" "text",
    "llm_temperature" numeric DEFAULT 0.7,
    "llm_base_url" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "llm_api_key" "text"
);


ALTER TABLE "public"."client_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."client_settings"."llm_api_key" IS 'API key for external LLM providers (Groq, OpenAI, Anthropic)';



CREATE TABLE IF NOT EXISTS "public"."client_webhooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "url" "text" NOT NULL,
    "secret" "text",
    "events" "text"[] DEFAULT ARRAY['lead.created'::"text", 'lead.replied'::"text", 'lead.bounced'::"text", 'lead.converted'::"text"] NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "retry_count" integer DEFAULT 3,
    "retry_delay_seconds" integer DEFAULT 60,
    "last_triggered_at" timestamp with time zone,
    "last_status_code" integer,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_webhooks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "plan" "text" DEFAULT 'starter'::"text" NOT NULL,
    "owner_email" "text" NOT NULL,
    "owner_name" "text",
    "phone" "text",
    "logo_url" "text",
    "website" "text",
    "seats" integer DEFAULT 1 NOT NULL,
    "daily_send_limit" integer DEFAULT 50 NOT NULL,
    "hourly_send_limit" integer DEFAULT 20 NOT NULL,
    "leads_limit" integer DEFAULT 1000 NOT NULL,
    "contacts_limit" integer DEFAULT 5000 NOT NULL,
    "discovery_enabled" boolean DEFAULT true NOT NULL,
    "enrichment_enabled" boolean DEFAULT true NOT NULL,
    "ai_outreach_enabled" boolean DEFAULT true NOT NULL,
    "custom_domain" "text",
    "stripe_customer_id" "text",
    "subscription_status" "text" DEFAULT 'active'::"text",
    "subscription_expires_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_paused" boolean DEFAULT false NOT NULL,
    "auto_paused" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_activity_at" timestamp with time zone,
    CONSTRAINT "clients_plan_check" CHECK (("plan" = ANY (ARRAY['starter'::"text", 'pro'::"text", 'enterprise'::"text"])))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_send_limits" (
    "product" "text" NOT NULL,
    "send_date" "date" NOT NULL,
    "sent_count" integer DEFAULT 0
);


ALTER TABLE "public"."daily_send_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_send_tracker" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "product" "text" NOT NULL,
    "send_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "send_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "brand_id" "uuid" NOT NULL,
    CONSTRAINT "daily_send_tracker_product_check" CHECK (("product" = ANY (ARRAY['kickin'::"text", 'relayforge'::"text", 'sentrazero'::"text"])))
);


ALTER TABLE "public"."daily_send_tracker" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dead_letter_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "reason" "text",
    "payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "client_id" "uuid"
);


ALTER TABLE "public"."dead_letter_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dead_letters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "failure_stage" "text",
    "error_message" "text",
    "error_payload" "jsonb",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "last_attempt_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved" boolean DEFAULT false NOT NULL,
    "client_id" "uuid",
    "failed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."dead_letters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovery_dead_letters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "source_id" "uuid",
    "payload" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "client_id" "uuid"
);


ALTER TABLE "public"."discovery_dead_letters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovery_embeddings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid",
    "intent_id" "uuid",
    "content_type" "text" NOT NULL,
    "content_text" "text" NOT NULL,
    "embedding" "public"."vector"(768) NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "search_vector" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", "content_text")) STORED,
    CONSTRAINT "discovery_embeddings_content_type_check" CHECK (("content_type" = ANY (ARRAY['brand_intent'::"text", 'signal_pattern'::"text", 'reference_company'::"text"])))
);


ALTER TABLE "public"."discovery_embeddings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovery_metrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_id" "uuid" NOT NULL,
    "executed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "companies_discovered" integer DEFAULT 0,
    "contacts_discovered" integer DEFAULT 0,
    "duration_ms" integer,
    "success" boolean,
    "error" "text"
);


ALTER TABLE "public"."discovery_metrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovery_query_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "intent_id" "uuid",
    "intent_text" "text" NOT NULL,
    "adapter" "text" NOT NULL,
    "query" "text" NOT NULL,
    "source_domain" "text",
    "raw_count" integer DEFAULT 0,
    "approved_count" integer DEFAULT 0,
    "lead_count" integer DEFAULT 0,
    "generated_at" timestamp with time zone DEFAULT "now"(),
    "run_id" "uuid"
);


ALTER TABLE "public"."discovery_query_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovery_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "name" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "config" "jsonb",
    "rate_limit_per_hour" integer,
    "rate_limit_per_day" integer,
    "is_active" boolean DEFAULT true,
    "last_run_at" timestamp with time zone,
    "next_run_at" timestamp with time zone,
    "retry_count" integer DEFAULT 0,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."discovery_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."domain_filters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain" "text" NOT NULL,
    "filter_type" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "domain_filters_filter_type_check" CHECK (("filter_type" = ANY (ARRAY['platform'::"text", 'media'::"text", 'job_board'::"text", 'aggregator'::"text", 'enterprise'::"text", 'recruiting_agency'::"text"])))
);


ALTER TABLE "public"."domain_filters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."edge_function_secrets" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "key_name" "text" NOT NULL,
    "key_value" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."edge_function_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "message_id" "uuid",
    "event_type" "text" NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['sent'::"text", 'delivered'::"text", 'opened'::"text", 'clicked'::"text", 'bounced'::"text", 'complained'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."email_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."enrichment_metrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "strategy" "text" NOT NULL,
    "llm_used" boolean DEFAULT false,
    "api_used" boolean DEFAULT false,
    "success" boolean NOT NULL,
    "confidence_before" numeric,
    "confidence_after" numeric,
    "duration_ms" integer,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."enrichment_metrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inbound_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."inbound_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inbound_message_claims" (
    "message_id" "text" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."inbound_message_claims" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_company_map" (
    "lead_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL
);


ALTER TABLE "public"."lead_company_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_import_batches" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "source" "text" NOT NULL,
    "product" "text" NOT NULL,
    "imported_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "client_id" "uuid",
    CONSTRAINT "import_product_check" CHECK (("product" = ANY (ARRAY['kickin'::"text", 'relayforge'::"text", 'sentrazero'::"text"])))
);


ALTER TABLE "public"."lead_import_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "full_name" "text",
    "email" "text",
    "domain" "text",
    "title" "text",
    "linkedin_url" "text",
    "source" "text" NOT NULL,
    "source_id" "text",
    "raw_payload" "jsonb",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "lead_score" numeric,
    "confidence_score" numeric,
    "rejection_reason" "text",
    "score_breakdown" "jsonb",
    "conversion_value" numeric DEFAULT 0,
    "deal_value" numeric,
    "closed_at" timestamp with time zone,
    "icp_version" "text",
    "scoring_version" "text",
    "company_id" "uuid",
    "scoring_version_id" "uuid",
    "brand_id" "uuid" NOT NULL,
    "retry_count" integer DEFAULT 0,
    "next_attempt_at" timestamp with time zone DEFAULT "now"(),
    "last_error" "text",
    "next_retry_at" timestamp with time zone,
    "state_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bounce_count" integer DEFAULT 0,
    "reply_count" integer DEFAULT 0,
    "last_outcome_at" timestamp with time zone,
    "client_id" "uuid",
    "notes" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "contacted_at" timestamp with time zone,
    CONSTRAINT "leads_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'researching'::"text", 'qualified'::"text", 'icp_passed'::"text", 'contacted'::"text", 'replied'::"text", 'negotiating'::"text", 'closed_won'::"text", 'closed_lost'::"text"])))
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "lead_id" "uuid",
    "subject" "text",
    "body" "text",
    "message_id" "text",
    "direction" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "message_key" "text",
    "retry_count" integer DEFAULT 0,
    "last_error" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "brand_id" "uuid" NOT NULL,
    "client_id" "uuid"
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."negotiation_drafts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "draft" "text" NOT NULL,
    "approved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "brand_id" "uuid" NOT NULL,
    "client_id" "uuid"
);


ALTER TABLE "public"."negotiation_drafts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "email_leads" boolean DEFAULT true,
    "email_replies" boolean DEFAULT true,
    "email_campaigns" boolean DEFAULT true,
    "email_digest" boolean DEFAULT true,
    "push_leads" boolean DEFAULT false,
    "push_replies" boolean DEFAULT true,
    "push_campaigns" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."opportunities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "intent_id" "uuid",
    "entity_type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "domain" "text",
    "signal" "text" NOT NULL,
    "sub_signal" "text",
    "source" "text" NOT NULL,
    "confidence" integer DEFAULT 50,
    "score" integer DEFAULT 0,
    "qualification_status" "text" DEFAULT 'new'::"text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "ingested" boolean DEFAULT false,
    "dead_letter" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "opportunities_confidence_check" CHECK ((("confidence" >= 0) AND ("confidence" <= 100))),
    CONSTRAINT "opportunities_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['company'::"text", 'person'::"text"]))),
    CONSTRAINT "opportunities_qualification_status_check" CHECK (("qualification_status" = ANY (ARRAY['new'::"text", 'qualified'::"text", 'contacted'::"text", 'replied'::"text", 'converted'::"text", 'disqualified'::"text"]))),
    CONSTRAINT "opportunities_score_check" CHECK ((("score" >= 0) AND ("score" <= 100)))
);


ALTER TABLE "public"."opportunities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."outbound_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "product" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "message_id" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "brand_id" "uuid" NOT NULL
);


ALTER TABLE "public"."outbound_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pre_validation_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "company_name" "text" NOT NULL,
    "domain" "text",
    "signal_type" "text",
    "provider_risk" "text",
    "geographic_match" boolean,
    "firmographic_fit" "text",
    "signal_quality" numeric,
    "passed" boolean NOT NULL,
    "rejection_reasons" "jsonb",
    "source_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pre_validation_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."qualification" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "fit_score" integer,
    "recommended_product" "text",
    "reasoning" "text",
    "confidence" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "brand_id" "uuid" NOT NULL,
    "client_id" "uuid",
    CONSTRAINT "qualification_confidence_check" CHECK ((("confidence" >= 0) AND ("confidence" <= 100))),
    CONSTRAINT "qualification_fit_score_check" CHECK ((("fit_score" >= 0) AND ("fit_score" <= 100))),
    CONSTRAINT "qualification_recommended_product_check" CHECK (("recommended_product" = ANY (ARRAY['kickin'::"text", 'relayforge'::"text", 'sentrazero'::"text"])))
);


ALTER TABLE "public"."qualification" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."replies" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "message_id" "text",
    "raw_message" "text",
    "intent" "text",
    "sentiment" "text",
    "objection_detected" boolean DEFAULT false,
    "meeting_requested" boolean DEFAULT false,
    "summary" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "confidence" numeric,
    "analyzed_at" timestamp with time zone,
    "brand_id" "uuid" NOT NULL,
    "client_id" "uuid",
    CONSTRAINT "replies_intent_check" CHECK (("intent" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text", 'negative'::"text", 'unsubscribe'::"text"])))
);


ALTER TABLE "public"."replies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "industry" "text",
    "size_estimate" "text",
    "pain_points" "text",
    "buying_signals" "text",
    "automation_maturity" "text",
    "sponsorship_potential" boolean,
    "summary" "text",
    "raw_content" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "brand_id" "uuid" NOT NULL,
    "client_id" "uuid"
);


ALTER TABLE "public"."research" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scoring_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "version_name" "text" NOT NULL,
    "scoring_config" "jsonb" NOT NULL,
    "is_active" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "brand_id" "uuid" NOT NULL
);


ALTER TABLE "public"."scoring_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."send_counters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product" "text" NOT NULL,
    "counter_type" "text" NOT NULL,
    "bucket_start" timestamp with time zone NOT NULL,
    "send_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "brand_id" "uuid" NOT NULL,
    "domain" "text",
    "bounce_count" integer DEFAULT 0,
    CONSTRAINT "send_counters_counter_type_check" CHECK (("counter_type" = ANY (ARRAY['hourly'::"text", 'daily'::"text"])))
);


ALTER TABLE "public"."send_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sending_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "domain" "text" NOT NULL,
    "daily_limit" integer DEFAULT 50 NOT NULL,
    "sent_today" integer DEFAULT 0 NOT NULL,
    "total_sent" integer DEFAULT 0 NOT NULL,
    "bounce_count" integer DEFAULT 0 NOT NULL,
    "last_reset_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "disabled_reason" "text",
    "disabled_at" timestamp with time zone
);


ALTER TABLE "public"."sending_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sent_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "brand_id" "uuid",
    "lead_id" "uuid",
    "company_id" "uuid",
    "message_key" "text" NOT NULL,
    "smtp_message_id" "text",
    "subject" "text",
    "body" "text",
    "direction" "text" NOT NULL,
    "from_email" "text",
    "to_email" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "sent_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "bounced_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "error_message" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sent_messages_direction_check" CHECK (("direction" = ANY (ARRAY['outbound'::"text", 'inbound'::"text"]))),
    CONSTRAINT "sent_messages_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'delivered'::"text", 'opened'::"text", 'clicked'::"text", 'bounced'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."sent_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."signal_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "signal_name" "text" NOT NULL,
    "weight" integer DEFAULT 20 NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."signal_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."signal_performance" (
    "product" "text" NOT NULL,
    "signal" "text" NOT NULL,
    "total_leads" integer DEFAULT 0,
    "total_closed" integer DEFAULT 0,
    "total_revenue" numeric DEFAULT 0,
    "brand_id" "uuid" NOT NULL
);


ALTER TABLE "public"."signal_performance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."signal_source_performance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "sends" integer DEFAULT 0,
    "replies" integer DEFAULT 0,
    "bounces" integer DEFAULT 0,
    "last_updated" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."signal_source_performance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."source_precision" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_name" "text" NOT NULL,
    "brand_id" "uuid",
    "total_signals" integer DEFAULT 0,
    "end_client_signals" integer DEFAULT 0,
    "provider_signals" integer DEFAULT 0,
    "false_positives" integer DEFAULT 0,
    "precision" numeric DEFAULT 0.5,
    "signal_to_noise" numeric DEFAULT 1.0,
    "source_weight" numeric DEFAULT 1.0,
    "last_updated" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."source_precision" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppression_list" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "email" "text",
    "domain" "text",
    "reason" "text",
    "source" "text",
    "is_hard" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."suppression_list" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_flags" (
    "key" "text" NOT NULL,
    "value" boolean NOT NULL,
    "client_id" "uuid"
);


ALTER TABLE "public"."system_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_health" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "check_type" "text" NOT NULL,
    "result" "text" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_health" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."top_performing_queries" AS
 SELECT "brand_id",
    "adapter",
    "query",
    "sum"("raw_count") AS "total_raw",
    "sum"("approved_count") AS "total_approved",
    "sum"("lead_count") AS "total_leads",
    "round"(((("sum"("approved_count"))::numeric / (NULLIF("sum"("raw_count"), 0))::numeric) * (100)::numeric), 1) AS "approval_rate_pct",
    "count"(*) AS "times_used",
    "max"("generated_at") AS "last_used"
   FROM "public"."discovery_query_log"
  WHERE ("generated_at" > ("now"() - '30 days'::interval))
  GROUP BY "brand_id", "adapter", "query"
 HAVING ("sum"("raw_count") > 0)
  ORDER BY ("sum"("approved_count")) DESC;


ALTER VIEW "public"."top_performing_queries" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_product_revenue_summary" AS
 SELECT "product",
    "sum"("total_revenue") AS "total_revenue",
    "sum"("total_closed") AS "total_closed",
        CASE
            WHEN ("sum"("total_closed") > 0) THEN ("sum"("total_revenue") / ("sum"("total_closed"))::numeric)
            ELSE (0)::numeric
        END AS "avg_ticket"
   FROM "public"."signal_performance"
  GROUP BY "product";


ALTER VIEW "public"."v_product_revenue_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_signal_revenue_analytics" AS
 SELECT "product",
    "signal",
    "total_leads",
    "total_closed",
        CASE
            WHEN ("total_closed" > 0) THEN ("total_revenue" / ("total_closed")::numeric)
            ELSE (0)::numeric
        END AS "avg_revenue_per_close",
        CASE
            WHEN ("total_leads" > 0) THEN (("total_closed")::numeric / ("total_leads")::numeric)
            ELSE (0)::numeric
        END AS "close_rate",
    "total_revenue"
   FROM "public"."signal_performance" "sp"
  ORDER BY
        CASE
            WHEN ("total_closed" > 0) THEN ("total_revenue" / ("total_closed")::numeric)
            ELSE (0)::numeric
        END DESC;


ALTER VIEW "public"."v_signal_revenue_analytics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."validation_feedback_loop" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "company_name" "text" NOT NULL,
    "domain" "text",
    "overall_confidence" numeric,
    "accepted" boolean NOT NULL,
    "converted" boolean DEFAULT false,
    "dimension_scores" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."validation_feedback_loop" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "webhook_id" "uuid" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "status_code" integer,
    "response_body" "text",
    "attempt_number" integer DEFAULT 1 NOT NULL,
    "success" boolean DEFAULT false NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "delivered_at" timestamp with time zone
);


ALTER TABLE "public"."webhook_deliveries" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activity_logs"
    ADD CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."adapter_config"
    ADD CONSTRAINT "adapter_config_adapter_name_key" UNIQUE ("adapter_name");



ALTER TABLE ONLY "public"."adapter_config"
    ADD CONSTRAINT "adapter_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_quota_counters"
    ADD CONSTRAINT "api_quota_counters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_rate_limit"
    ADD CONSTRAINT "api_rate_limit_api_key_id_window_start_key" UNIQUE ("api_key_id", "window_start");



ALTER TABLE ONLY "public"."api_rate_limit"
    ADD CONSTRAINT "api_rate_limit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_usage_logs"
    ADD CONSTRAINT "api_usage_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blacklist"
    ADD CONSTRAINT "blacklist_domain_unique" UNIQUE ("domain");



ALTER TABLE ONLY "public"."blacklist"
    ADD CONSTRAINT "blacklist_email_unique" UNIQUE ("email");



ALTER TABLE ONLY "public"."blacklist"
    ADD CONSTRAINT "blacklist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brand_discovery_sources"
    ADD CONSTRAINT "brand_discovery_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brand_intents"
    ADD CONSTRAINT "brand_intent_unique" UNIQUE ("brand_id", "intent");



ALTER TABLE ONLY "public"."brand_intents"
    ADD CONSTRAINT "brand_intents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brand_profiles"
    ADD CONSTRAINT "brand_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_analytics"
    ADD CONSTRAINT "campaign_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."circuit_breaker_state"
    ADD CONSTRAINT "circuit_breaker_state_client_id_entity_type_entity_id_key" UNIQUE ("client_id", "entity_type", "entity_id");



ALTER TABLE ONLY "public"."circuit_breaker_state"
    ADD CONSTRAINT "circuit_breaker_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_api_keys"
    ADD CONSTRAINT "client_api_keys_key_hash_key" UNIQUE ("key_hash");



ALTER TABLE ONLY "public"."client_api_keys"
    ADD CONSTRAINT "client_api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_daily_send"
    ADD CONSTRAINT "client_daily_send_client_id_send_date_key" UNIQUE ("client_id", "send_date");



ALTER TABLE ONLY "public"."client_daily_send"
    ADD CONSTRAINT "client_daily_send_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_hourly_send"
    ADD CONSTRAINT "client_hourly_send_client_id_hour_bucket_key" UNIQUE ("client_id", "hour_bucket");



ALTER TABLE ONLY "public"."client_hourly_send"
    ADD CONSTRAINT "client_hourly_send_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_members"
    ADD CONSTRAINT "client_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_members"
    ADD CONSTRAINT "client_members_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."client_settings"
    ADD CONSTRAINT "client_settings_client_id_key" UNIQUE ("client_id");



ALTER TABLE ONLY "public"."client_settings"
    ADD CONSTRAINT "client_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_webhooks"
    ADD CONSTRAINT "client_webhooks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_send_limits"
    ADD CONSTRAINT "daily_send_limits_pkey" PRIMARY KEY ("product", "send_date");



ALTER TABLE ONLY "public"."daily_send_tracker"
    ADD CONSTRAINT "daily_send_tracker_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_send_tracker"
    ADD CONSTRAINT "daily_send_tracker_product_send_date_key" UNIQUE ("product", "send_date");



ALTER TABLE ONLY "public"."dead_letter_queue"
    ADD CONSTRAINT "dead_letter_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dead_letters"
    ADD CONSTRAINT "dead_letters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovered_companies"
    ADD CONSTRAINT "discovered_companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovered_contacts"
    ADD CONSTRAINT "discovered_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovery_dead_letters"
    ADD CONSTRAINT "discovery_dead_letters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovery_embeddings"
    ADD CONSTRAINT "discovery_embeddings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovery_metrics"
    ADD CONSTRAINT "discovery_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovery_query_log"
    ADD CONSTRAINT "discovery_query_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovery_sources"
    ADD CONSTRAINT "discovery_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domain_filters"
    ADD CONSTRAINT "domain_filters_domain_filter_type_key" UNIQUE ("domain", "filter_type");



ALTER TABLE ONLY "public"."domain_filters"
    ADD CONSTRAINT "domain_filters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."edge_function_secrets"
    ADD CONSTRAINT "edge_function_secrets_key_name_key" UNIQUE ("key_name");



ALTER TABLE ONLY "public"."edge_function_secrets"
    ADD CONSTRAINT "edge_function_secrets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enrichment_metrics"
    ADD CONSTRAINT "enrichment_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inbound_events"
    ADD CONSTRAINT "inbound_events_event_id_key" UNIQUE ("event_id");



ALTER TABLE ONLY "public"."inbound_events"
    ADD CONSTRAINT "inbound_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inbound_message_claims"
    ADD CONSTRAINT "inbound_message_claims_pkey" PRIMARY KEY ("message_id", "brand_id");



ALTER TABLE ONLY "public"."lead_company_map"
    ADD CONSTRAINT "lead_company_map_pkey" PRIMARY KEY ("lead_id", "company_id");



ALTER TABLE ONLY "public"."lead_import_batches"
    ADD CONSTRAINT "lead_import_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_message_id_unique" UNIQUE ("message_id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."negotiation_drafts"
    ADD CONSTRAINT "negotiation_drafts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_client_id_key" UNIQUE ("user_id", "client_id");



ALTER TABLE ONLY "public"."opportunities"
    ADD CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."opportunities"
    ADD CONSTRAINT "opportunity_unique" UNIQUE ("brand_id", "domain", "source", "signal");



ALTER TABLE ONLY "public"."outbound_events"
    ADD CONSTRAINT "outbound_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."outreach"
    ADD CONSTRAINT "outreach_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pre_validation_log"
    ADD CONSTRAINT "pre_validation_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."qualification"
    ADD CONSTRAINT "qualification_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."replies"
    ADD CONSTRAINT "replies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research"
    ADD CONSTRAINT "research_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scoring_versions"
    ADD CONSTRAINT "scoring_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."send_counters"
    ADD CONSTRAINT "send_counters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sending_domains"
    ADD CONSTRAINT "sending_domains_brand_id_domain_key" UNIQUE ("brand_id", "domain");



ALTER TABLE ONLY "public"."sending_domains"
    ADD CONSTRAINT "sending_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sent_messages"
    ADD CONSTRAINT "sent_messages_message_key_key" UNIQUE ("message_key");



ALTER TABLE ONLY "public"."sent_messages"
    ADD CONSTRAINT "sent_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signal_config"
    ADD CONSTRAINT "signal_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signal_config"
    ADD CONSTRAINT "signal_config_signal_name_key" UNIQUE ("signal_name");



ALTER TABLE ONLY "public"."signal_performance"
    ADD CONSTRAINT "signal_performance_pkey" PRIMARY KEY ("product", "signal");



ALTER TABLE ONLY "public"."signal_source_performance"
    ADD CONSTRAINT "signal_source_performance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."source_precision"
    ADD CONSTRAINT "source_precision_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."source_precision"
    ADD CONSTRAINT "source_precision_source_name_brand_id_key" UNIQUE ("source_name", "brand_id");



ALTER TABLE ONLY "public"."suppression_list"
    ADD CONSTRAINT "suppression_list_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_flags"
    ADD CONSTRAINT "system_flags_client_id_key" UNIQUE ("client_id", "key");



ALTER TABLE ONLY "public"."system_flags"
    ADD CONSTRAINT "system_flags_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."system_health"
    ADD CONSTRAINT "system_health_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovered_companies"
    ADD CONSTRAINT "unique_brand_domain" UNIQUE ("brand_id", "domain");



ALTER TABLE ONLY "public"."replies"
    ADD CONSTRAINT "unique_message_id" UNIQUE ("message_id");



ALTER TABLE ONLY "public"."send_counters"
    ADD CONSTRAINT "unique_product_bucket" UNIQUE ("product", "counter_type", "bucket_start");



ALTER TABLE ONLY "public"."api_quota_counters"
    ADD CONSTRAINT "unique_source_window" UNIQUE ("source_id", "window_start");



ALTER TABLE ONLY "public"."validation_feedback_loop"
    ADD CONSTRAINT "validation_feedback_loop_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id");



CREATE INDEX "brand_intents_priority_idx" ON "public"."brand_intents" USING "btree" ("priority");



CREATE UNIQUE INDEX "circuit_breaker_brand_unique" ON "public"."circuit_breaker_state" USING "btree" ("brand_id") WHERE ("brand_id" IS NOT NULL);



CREATE INDEX "dead_letters_brand_idx" ON "public"."dead_letters" USING "btree" ("brand_id");



CREATE INDEX "dead_letters_entity_idx" ON "public"."dead_letters" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "enrichment_metrics_brand_id_idx" ON "public"."enrichment_metrics" USING "btree" ("brand_id");



CREATE INDEX "idx_activity_logs_client" ON "public"."activity_logs" USING "btree" ("client_id", "created_at");



CREATE INDEX "idx_api_quota_window" ON "public"."api_quota_counters" USING "btree" ("source_id", "window_start");



CREATE INDEX "idx_api_rate_limit_key" ON "public"."api_rate_limit" USING "btree" ("api_key_id", "window_start");



CREATE INDEX "idx_api_usage_logs_client" ON "public"."api_usage_logs" USING "btree" ("client_id");



CREATE INDEX "idx_api_usage_logs_created" ON "public"."api_usage_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_api_usage_logs_endpoint" ON "public"."api_usage_logs" USING "btree" ("endpoint");



CREATE INDEX "idx_audit_logs_action" ON "public"."audit_logs" USING "btree" ("action");



CREATE INDEX "idx_audit_logs_client" ON "public"."audit_logs" USING "btree" ("client_id");



CREATE INDEX "idx_audit_logs_created" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_bds_active" ON "public"."brand_discovery_sources" USING "btree" ("brand_id") WHERE ("is_active" = true);



CREATE INDEX "idx_bds_brand" ON "public"."brand_discovery_sources" USING "btree" ("brand_id");



CREATE UNIQUE INDEX "idx_bds_unique" ON "public"."brand_discovery_sources" USING "btree" ("brand_id", "name");



CREATE INDEX "idx_blacklist_domain" ON "public"."blacklist" USING "btree" ("domain");



CREATE UNIQUE INDEX "idx_blacklist_email" ON "public"."blacklist" USING "btree" ("email");



CREATE INDEX "idx_brand_intents_active" ON "public"."brand_intents" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_brand_intents_brand_id" ON "public"."brand_intents" USING "btree" ("brand_id");



CREATE INDEX "idx_brand_profiles_client" ON "public"."brand_profiles" USING "btree" ("client_id");



CREATE INDEX "idx_brand_profiles_discovery_api_key" ON "public"."brand_profiles" USING "btree" ("discovery_api_key") WHERE ("discovery_api_key" IS NOT NULL);



CREATE INDEX "idx_brand_profiles_discovery_enabled" ON "public"."brand_profiles" USING "btree" ("discovery_enabled");



CREATE INDEX "idx_brand_profiles_is_active" ON "public"."brand_profiles" USING "btree" ("is_active");



CREATE INDEX "idx_brand_profiles_is_paused" ON "public"."brand_profiles" USING "btree" ("is_paused");



CREATE INDEX "idx_brand_profiles_outbound_enabled" ON "public"."brand_profiles" USING "btree" ("outbound_enabled");



CREATE INDEX "idx_circuit_breaker_client" ON "public"."circuit_breaker_state" USING "btree" ("client_id");



CREATE INDEX "idx_circuit_breaker_state" ON "public"."circuit_breaker_state" USING "btree" ("state");



CREATE INDEX "idx_client_api_keys_client" ON "public"."client_api_keys" USING "btree" ("client_id") WHERE ("is_active" = true);



CREATE INDEX "idx_client_daily_send_client" ON "public"."client_daily_send" USING "btree" ("client_id", "send_date");



CREATE INDEX "idx_client_daily_send_client_date" ON "public"."client_daily_send" USING "btree" ("client_id", "send_date");



CREATE INDEX "idx_client_hourly_send_client" ON "public"."client_hourly_send" USING "btree" ("client_id", "hour_bucket");



CREATE INDEX "idx_client_members_client" ON "public"."client_members" USING "btree" ("client_id");



CREATE INDEX "idx_client_members_email" ON "public"."client_members" USING "btree" ("email");



CREATE INDEX "idx_client_members_user_id" ON "public"."client_members" USING "btree" ("user_id");



CREATE INDEX "idx_client_settings_llm_provider" ON "public"."client_settings" USING "btree" ("llm_provider") WHERE ("llm_provider" IS NOT NULL);



CREATE INDEX "idx_client_webhooks_client" ON "public"."client_webhooks" USING "btree" ("client_id") WHERE ("is_active" = true);



CREATE INDEX "idx_clients_is_active" ON "public"."clients" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_clients_owner_email" ON "public"."clients" USING "btree" ("owner_email");



CREATE INDEX "idx_clients_slug" ON "public"."clients" USING "btree" ("slug");



CREATE INDEX "idx_companies_brand" ON "public"."companies" USING "btree" ("brand_id");



CREATE INDEX "idx_companies_brand_status" ON "public"."companies" USING "btree" ("brand_id", "status");



CREATE INDEX "idx_companies_client_status" ON "public"."companies" USING "btree" ("client_id", "status");



CREATE INDEX "idx_companies_domain" ON "public"."companies" USING "btree" ("domain");



CREATE UNIQUE INDEX "idx_companies_domain_unique" ON "public"."companies" USING "btree" ("domain") WHERE ("domain" IS NOT NULL);



CREATE INDEX "idx_companies_state_updated_at" ON "public"."companies" USING "btree" ("state_updated_at");



CREATE INDEX "idx_companies_status" ON "public"."companies" USING "btree" ("status");



CREATE INDEX "idx_daily_send_tracker_brand" ON "public"."daily_send_tracker" USING "btree" ("brand_id");



CREATE INDEX "idx_discovered_companies_brand" ON "public"."discovered_companies" USING "btree" ("brand_id");



CREATE INDEX "idx_discovered_companies_confidence" ON "public"."discovered_companies" USING "btree" ("confidence");



CREATE INDEX "idx_discovered_companies_relevance" ON "public"."discovered_companies" USING "btree" ("relevance_score") WHERE ("relevance_score" >= (70)::numeric);



CREATE INDEX "idx_discovered_companies_signal_type" ON "public"."discovered_companies" USING "btree" ("signal_type");



CREATE INDEX "idx_discovered_companies_unprocessed" ON "public"."discovered_companies" USING "btree" ("brand_id") WHERE ("processed" = false);



CREATE INDEX "idx_discovered_contacts_brand" ON "public"."discovered_contacts" USING "btree" ("brand_id");



CREATE INDEX "idx_discovered_contacts_confidence" ON "public"."discovered_contacts" USING "btree" ("confidence");



CREATE INDEX "idx_discovered_contacts_enrichment" ON "public"."discovered_contacts" USING "btree" ("requires_enrichment", "processed");



CREATE INDEX "idx_discovered_contacts_enrichment_queue" ON "public"."discovered_contacts" USING "btree" ("requires_enrichment", "next_attempt_at");



CREATE INDEX "idx_discovered_contacts_retry_queue" ON "public"."discovered_contacts" USING "btree" ("brand_id", "next_attempt_at") WHERE ("processed" = false);



CREATE INDEX "idx_discovered_contacts_unprocessed" ON "public"."discovered_contacts" USING "btree" ("brand_id") WHERE ("processed" = false);



CREATE INDEX "idx_discovered_retry_queue" ON "public"."discovered_companies" USING "btree" ("brand_id", "next_attempt_at") WHERE ("processed" = false);



CREATE INDEX "idx_discovered_unprocessed_order" ON "public"."discovered_companies" USING "btree" ("discovered_at") WHERE ("processed" = false);



CREATE INDEX "idx_discovery_embeddings_brand" ON "public"."discovery_embeddings" USING "btree" ("brand_id");



CREATE INDEX "idx_discovery_embeddings_fts" ON "public"."discovery_embeddings" USING "gin" ("search_vector");



CREATE INDEX "idx_discovery_embeddings_type" ON "public"."discovery_embeddings" USING "btree" ("content_type");



CREATE INDEX "idx_discovery_embeddings_vector" ON "public"."discovery_embeddings" USING "ivfflat" ("embedding" "public"."vector_cosine_ops") WITH ("lists"='100');



CREATE INDEX "idx_discovery_sources_ready" ON "public"."brand_discovery_sources" USING "btree" ("brand_id", "is_active", "next_attempt_at") WHERE ("is_active" = true);



CREATE INDEX "idx_dql_brand_approved" ON "public"."discovery_query_log" USING "btree" ("brand_id", "approved_count" DESC, "generated_at" DESC);



CREATE INDEX "idx_dql_brand_query" ON "public"."discovery_query_log" USING "btree" ("brand_id", "query", "generated_at" DESC);



CREATE INDEX "idx_email_events_client" ON "public"."email_events" USING "btree" ("client_id");



CREATE INDEX "idx_email_events_message" ON "public"."email_events" USING "btree" ("message_id");



CREATE INDEX "idx_email_events_type" ON "public"."email_events" USING "btree" ("event_type");



CREATE INDEX "idx_inbound_events_brand" ON "public"."inbound_events" USING "btree" ("brand_id");



CREATE INDEX "idx_inbound_events_event_id" ON "public"."inbound_events" USING "btree" ("event_id");



CREATE INDEX "idx_lcm_brand" ON "public"."lead_company_map" USING "btree" ("brand_id");



CREATE INDEX "idx_leads_brand" ON "public"."leads" USING "btree" ("brand_id");



CREATE INDEX "idx_leads_brand_status" ON "public"."leads" USING "btree" ("brand_id", "status");



CREATE INDEX "idx_leads_client_status" ON "public"."leads" USING "btree" ("client_id", "status");



CREATE INDEX "idx_leads_company_id" ON "public"."leads" USING "btree" ("company_id");



CREATE INDEX "idx_leads_conversion" ON "public"."leads" USING "btree" ("conversion_value" DESC);



CREATE INDEX "idx_leads_domain" ON "public"."leads" USING "btree" ("domain");



CREATE INDEX "idx_leads_email" ON "public"."leads" USING "btree" ("email");



CREATE INDEX "idx_leads_score" ON "public"."leads" USING "btree" ("lead_score" DESC);



CREATE INDEX "idx_leads_status" ON "public"."leads" USING "btree" ("status");



CREATE INDEX "idx_messages_brand" ON "public"."messages" USING "btree" ("brand_id");



CREATE INDEX "idx_negotiation_company" ON "public"."negotiation_drafts" USING "btree" ("company_id");



CREATE INDEX "idx_negotiation_drafts_brand" ON "public"."negotiation_drafts" USING "btree" ("brand_id");



CREATE UNIQUE INDEX "idx_one_active_scoring_per_brand" ON "public"."scoring_versions" USING "btree" ("brand_id") WHERE ("is_active" = true);



CREATE INDEX "idx_opportunities_brand_id" ON "public"."opportunities" USING "btree" ("brand_id");



CREATE INDEX "idx_opportunities_domain" ON "public"."opportunities" USING "btree" ("domain") WHERE ("domain" IS NOT NULL);



CREATE INDEX "idx_opportunities_qualification" ON "public"."opportunities" USING "btree" ("qualification_status") WHERE ("qualification_status" = 'new'::"text");



CREATE INDEX "idx_opportunities_score" ON "public"."opportunities" USING "btree" ("score" DESC);



CREATE INDEX "idx_opportunities_signal" ON "public"."opportunities" USING "btree" ("signal");



CREATE INDEX "idx_outbound_events_brand" ON "public"."outbound_events" USING "btree" ("brand_id");



CREATE INDEX "idx_outbound_events_company" ON "public"."outbound_events" USING "btree" ("company_id");



CREATE INDEX "idx_outbound_events_product" ON "public"."outbound_events" USING "btree" ("product");



CREATE INDEX "idx_outreach_brand" ON "public"."outreach" USING "btree" ("brand_id");



CREATE INDEX "idx_outreach_company" ON "public"."outreach" USING "btree" ("company_id");



CREATE INDEX "idx_outreach_status" ON "public"."outreach" USING "btree" ("status");



CREATE INDEX "idx_pvl_brand_passed" ON "public"."pre_validation_log" USING "btree" ("brand_id", "passed", "created_at" DESC);



CREATE INDEX "idx_qualification_brand" ON "public"."qualification" USING "btree" ("brand_id");



CREATE INDEX "idx_qualification_company" ON "public"."qualification" USING "btree" ("company_id");



CREATE INDEX "idx_qualification_score" ON "public"."qualification" USING "btree" ("fit_score");



CREATE INDEX "idx_replies_brand" ON "public"."replies" USING "btree" ("brand_id");



CREATE INDEX "idx_replies_company" ON "public"."replies" USING "btree" ("company_id");



CREATE INDEX "idx_replies_intent" ON "public"."replies" USING "btree" ("intent");



CREATE INDEX "idx_research_brand" ON "public"."research" USING "btree" ("brand_id");



CREATE INDEX "idx_research_company" ON "public"."research" USING "btree" ("company_id");



CREATE INDEX "idx_scoring_versions_brand" ON "public"."scoring_versions" USING "btree" ("brand_id");



CREATE INDEX "idx_scoring_versions_brand_active" ON "public"."scoring_versions" USING "btree" ("brand_id", "is_active");



CREATE INDEX "idx_send_counters_brand" ON "public"."send_counters" USING "btree" ("brand_id");



CREATE INDEX "idx_send_counters_brand_date" ON "public"."send_counters" USING "btree" ("brand_id", "bucket_start");



CREATE INDEX "idx_send_counters_bucket" ON "public"."send_counters" USING "btree" ("bucket_start");



CREATE INDEX "idx_send_counters_product" ON "public"."send_counters" USING "btree" ("product");



CREATE INDEX "idx_sent_messages_brand" ON "public"."sent_messages" USING "btree" ("brand_id");



CREATE INDEX "idx_sent_messages_client" ON "public"."sent_messages" USING "btree" ("client_id");



CREATE INDEX "idx_sent_messages_lead" ON "public"."sent_messages" USING "btree" ("lead_id");



CREATE UNIQUE INDEX "idx_sent_messages_message_key" ON "public"."sent_messages" USING "btree" ("message_key");



CREATE INDEX "idx_sent_messages_status_client" ON "public"."sent_messages" USING "btree" ("client_id", "status") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_signal_performance_brand" ON "public"."signal_performance" USING "btree" ("brand_id");



CREATE INDEX "idx_source_precision_brand" ON "public"."source_precision" USING "btree" ("brand_id", "precision" DESC);



CREATE INDEX "idx_suppression_list_client" ON "public"."suppression_list" USING "btree" ("client_id");



CREATE INDEX "idx_suppression_list_domain" ON "public"."suppression_list" USING "btree" ("domain");



CREATE INDEX "idx_suppression_list_email" ON "public"."suppression_list" USING "btree" ("email");



CREATE UNIQUE INDEX "idx_unique_brand_domain" ON "public"."companies" USING "btree" ("brand_id", "domain");



CREATE UNIQUE INDEX "idx_unique_company_brand_domain" ON "public"."companies" USING "btree" ("brand_id", "domain");



CREATE UNIQUE INDEX "idx_unique_daily_send" ON "public"."daily_send_tracker" USING "btree" ("brand_id", "send_date");



CREATE UNIQUE INDEX "idx_unique_discovered_email_per_brand" ON "public"."discovered_contacts" USING "btree" ("brand_id", "email") WHERE ("email" IS NOT NULL);



CREATE UNIQUE INDEX "idx_unique_leads_brand_email" ON "public"."leads" USING "btree" ("brand_id", "email") WHERE ("email" IS NOT NULL);



CREATE UNIQUE INDEX "idx_unique_send_hour" ON "public"."send_counters" USING "btree" ("brand_id", "counter_type", "bucket_start");



CREATE UNIQUE INDEX "idx_unique_signal_brand" ON "public"."signal_performance" USING "btree" ("brand_id", "signal");



CREATE INDEX "idx_vfl_brand_converted" ON "public"."validation_feedback_loop" USING "btree" ("brand_id", "converted", "created_at" DESC);



CREATE INDEX "leads_retry_idx" ON "public"."leads" USING "btree" ("status", "next_retry_at");



CREATE INDEX "leads_state_updated_idx" ON "public"."leads" USING "btree" ("state_updated_at");



CREATE UNIQUE INDEX "messages_message_key_unique" ON "public"."messages" USING "btree" ("message_key");



CREATE INDEX "sending_domains_active_idx" ON "public"."sending_domains" USING "btree" ("is_active");



CREATE INDEX "sending_domains_brand_idx" ON "public"."sending_domains" USING "btree" ("brand_id");



CREATE OR REPLACE TRIGGER "trg_create_company_from_lead" AFTER UPDATE OF "status" ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_create_company_from_lead"();



CREATE OR REPLACE TRIGGER "trg_set_discovered_companies_updated_at" BEFORE UPDATE ON "public"."discovered_companies" FOR EACH ROW EXECUTE FUNCTION "public"."set_discovered_companies_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_handle_new_client" AFTER INSERT ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_client"();



CREATE OR REPLACE TRIGGER "update_brand_profiles_updated_at" BEFORE UPDATE ON "public"."brand_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_client_settings_updated_at" BEFORE UPDATE ON "public"."client_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_client_webhooks_updated_at" BEFORE UPDATE ON "public"."client_webhooks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_clients_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."activity_logs"
    ADD CONSTRAINT "activity_logs_client_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api_quota_counters"
    ADD CONSTRAINT "api_quota_counters_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."brand_discovery_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api_rate_limit"
    ADD CONSTRAINT "api_rate_limit_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."client_api_keys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api_usage_logs"
    ADD CONSTRAINT "api_usage_logs_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."client_api_keys"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."api_usage_logs"
    ADD CONSTRAINT "api_usage_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_client_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brand_discovery_sources"
    ADD CONSTRAINT "brand_discovery_sources_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."brand_intents"
    ADD CONSTRAINT "brand_intents_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brand_profiles"
    ADD CONSTRAINT "brand_profiles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."circuit_breaker_state"
    ADD CONSTRAINT "circuit_breaker_state_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_api_keys"
    ADD CONSTRAINT "client_api_keys_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_daily_send"
    ADD CONSTRAINT "client_daily_send_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_hourly_send"
    ADD CONSTRAINT "client_hourly_send_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_members"
    ADD CONSTRAINT "client_members_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_members"
    ADD CONSTRAINT "client_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_settings"
    ADD CONSTRAINT "client_settings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_webhooks"
    ADD CONSTRAINT "client_webhooks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dead_letter_queue"
    ADD CONSTRAINT "dead_letter_queue_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dead_letters"
    ADD CONSTRAINT "dead_letters_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."discovered_companies"
    ADD CONSTRAINT "discovered_companies_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."discovered_companies"
    ADD CONSTRAINT "discovered_companies_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."brand_discovery_sources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."discovered_contacts"
    ADD CONSTRAINT "discovered_contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."discovered_contacts"
    ADD CONSTRAINT "discovered_contacts_discovered_company_id_fkey" FOREIGN KEY ("discovered_company_id") REFERENCES "public"."discovered_companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."discovered_contacts"
    ADD CONSTRAINT "discovered_contacts_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."brand_discovery_sources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."discovery_dead_letters"
    ADD CONSTRAINT "discovery_dead_letters_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."discovery_embeddings"
    ADD CONSTRAINT "discovery_embeddings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."discovery_metrics"
    ADD CONSTRAINT "discovery_metrics_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."brand_discovery_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."discovery_query_log"
    ADD CONSTRAINT "discovery_query_log_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."discovery_query_log"
    ADD CONSTRAINT "discovery_query_log_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "public"."brand_intents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."discovery_sources"
    ADD CONSTRAINT "discovery_sources_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_events"
    ADD CONSTRAINT "email_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."sent_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lead_company_map"
    ADD CONSTRAINT "lead_company_map_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_company_map"
    ADD CONSTRAINT "lead_company_map_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_import_batches"
    ADD CONSTRAINT "lead_import_batches_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_scoring_version_id_fkey" FOREIGN KEY ("scoring_version_id") REFERENCES "public"."scoring_versions"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."negotiation_drafts"
    ADD CONSTRAINT "negotiation_drafts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."negotiation_drafts"
    ADD CONSTRAINT "negotiation_drafts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."opportunities"
    ADD CONSTRAINT "opportunities_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."opportunities"
    ADD CONSTRAINT "opportunities_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "public"."brand_intents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."outreach"
    ADD CONSTRAINT "outreach_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."outreach"
    ADD CONSTRAINT "outreach_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pre_validation_log"
    ADD CONSTRAINT "pre_validation_log_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."qualification"
    ADD CONSTRAINT "qualification_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."qualification"
    ADD CONSTRAINT "qualification_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."replies"
    ADD CONSTRAINT "replies_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."replies"
    ADD CONSTRAINT "replies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research"
    ADD CONSTRAINT "research_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."research"
    ADD CONSTRAINT "research_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sent_messages"
    ADD CONSTRAINT "sent_messages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sent_messages"
    ADD CONSTRAINT "sent_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sent_messages"
    ADD CONSTRAINT "sent_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_precision"
    ADD CONSTRAINT "source_precision_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."suppression_list"
    ADD CONSTRAINT "suppression_list_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."validation_feedback_loop"
    ADD CONSTRAINT "validation_feedback_loop_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brand_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "public"."client_webhooks"("id") ON DELETE CASCADE;



CREATE POLICY "Activity logs viewable by client members" ON "public"."activity_logs" FOR SELECT USING (("client_id" = "public"."client_id"()));



CREATE POLICY "Audit logs viewable by client members" ON "public"."audit_logs" FOR SELECT USING (("client_id" = "public"."client_id"()));



CREATE POLICY "Brand profiles are viewable by client members" ON "public"."brand_profiles" USING (("client_id" = "public"."client_id"()));



CREATE POLICY "Clients can view own client" ON "public"."clients" FOR SELECT USING (("id" = "public"."client_id"()));



CREATE POLICY "Companies are viewable by client members" ON "public"."companies" USING (("client_id" = "public"."client_id"()));



CREATE POLICY "Leads are viewable by client members" ON "public"."leads" USING (("client_id" = "public"."client_id"()));



CREATE POLICY "Members can insert own client members" ON "public"."client_members" FOR INSERT WITH CHECK ((("client_id" = "public"."client_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."client_members" "cm"
  WHERE (("cm"."client_id" = "client_members"."client_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = ANY (ARRAY['owner'::"text", 'admin'::"text"])))))));



CREATE POLICY "Members can update own client members" ON "public"."client_members" FOR UPDATE USING ((("client_id" = "public"."client_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."client_members" "cm"
  WHERE (("cm"."client_id" = "client_members"."client_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = ANY (ARRAY['owner'::"text", 'admin'::"text"])))))));



CREATE POLICY "Members can view own client" ON "public"."client_members" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Service role can manage all activity logs" ON "public"."activity_logs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage all companies" ON "public"."companies" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage all discovered companies" ON "public"."discovered_companies" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage all discovered contacts" ON "public"."discovered_contacts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage all discovery sources" ON "public"."brand_discovery_sources" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage all leads" ON "public"."leads" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage all opportunities" ON "public"."opportunities" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage brand_intents" ON "public"."brand_intents" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage opportunities" ON "public"."opportunities" USING (true) WITH CHECK (true);



CREATE POLICY "Users can access their client brands" ON "public"."brand_profiles" USING (("client_id" IN ( SELECT "client_members"."client_id"
   FROM "public"."client_members"
  WHERE ("client_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can manage own notifications" ON "public"."notification_preferences" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view their own brand's opportunities" ON "public"."opportunities" FOR SELECT USING (("brand_id" IN ( SELECT "brand_profiles"."id"
   FROM "public"."brand_profiles"
  WHERE ("brand_profiles"."client_id" = "public"."client_id"()))));



CREATE POLICY "Users can view their own client's activity logs" ON "public"."activity_logs" FOR SELECT USING (("client_id" = "public"."client_id"()));



CREATE POLICY "Users can view their own client's companies" ON "public"."companies" FOR SELECT USING (("client_id" = "public"."client_id"()));



CREATE POLICY "Users can view their own client's discovered companies" ON "public"."discovered_companies" FOR SELECT USING (("client_id" = "public"."client_id"()));



CREATE POLICY "Users can view their own client's discovered contacts" ON "public"."discovered_contacts" FOR SELECT USING (("client_id" = "public"."client_id"()));



CREATE POLICY "Users can view their own client's discovery sources" ON "public"."brand_discovery_sources" FOR SELECT USING (("client_id" = "public"."client_id"()));



CREATE POLICY "Users can view their own client's leads" ON "public"."leads" FOR SELECT USING (("client_id" = "public"."client_id"()));



ALTER TABLE "public"."activity_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_logs_can_view_own" ON "public"."activity_logs" FOR SELECT USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "activity_logs_insert" ON "public"."activity_logs" FOR INSERT WITH CHECK ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "activity_logs_service_role" ON "public"."activity_logs" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."adapter_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."api_quota_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."api_rate_limit" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "api_rate_limit_service_role" ON "public"."api_rate_limit" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."api_usage_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "api_usage_logs_service_role" ON "public"."api_usage_logs" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_can_view_own" ON "public"."audit_logs" FOR SELECT USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "audit_logs_service_role" ON "public"."audit_logs" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "auth to all" ON "public"."brand_discovery_sources" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."blacklist" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "blacklist_all" ON "public"."blacklist" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."brand_discovery_sources" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "brand_discovery_sources_all_authenticated" ON "public"."brand_discovery_sources" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "brand_discovery_sources_can_view_own" ON "public"."brand_discovery_sources" USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "brand_profiles"."id"
   FROM "public"."brand_profiles"
  WHERE ("brand_profiles"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "brand_discovery_sources_delete_own" ON "public"."brand_discovery_sources" FOR DELETE USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "brand_discovery_sources_insert_own" ON "public"."brand_discovery_sources" FOR INSERT WITH CHECK ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "brand_discovery_sources_select_own" ON "public"."brand_discovery_sources" FOR SELECT USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "brand_discovery_sources_service_role" ON "public"."brand_discovery_sources" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "brand_discovery_sources_update_own" ON "public"."brand_discovery_sources" FOR UPDATE USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."brand_intents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brand_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brand_profiles_backup" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "brand_profiles_can_view_own" ON "public"."brand_profiles" USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "brand_profiles_service_role" ON "public"."brand_profiles" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."campaign_analytics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "campaign_analytics_can_view_own" ON "public"."campaign_analytics" USING ((("brand_id" IN ( SELECT "brand_profiles"."id"
   FROM "public"."brand_profiles"
  WHERE ("brand_profiles"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "campaign_analytics_service_role" ON "public"."campaign_analytics" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "circuit_breaker_all_authenticated" ON "public"."circuit_breaker_state" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "circuit_breaker_select_own" ON "public"."circuit_breaker_state" FOR SELECT USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."circuit_breaker_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_api_keys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_api_keys_can_view_own" ON "public"."client_api_keys" USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_api_keys_service_role" ON "public"."client_api_keys" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."client_daily_send" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_daily_send_all_authenticated" ON "public"."client_daily_send" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "client_daily_send_can_view_own" ON "public"."client_daily_send" FOR SELECT USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_daily_send_select_own" ON "public"."client_daily_send" FOR SELECT USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_daily_send_service_role" ON "public"."client_daily_send" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."client_hourly_send" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_members_can_insert" ON "public"."client_members" FOR INSERT WITH CHECK ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_members_can_update" ON "public"."client_members" FOR UPDATE USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_members_can_view_own" ON "public"."client_members" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "client_members_select_own" ON "public"."client_members" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("email" = ("auth"."jwt"() ->> 'email'::"text")) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_members_service_role" ON "public"."client_members" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "client_members_update_own" ON "public"."client_members" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."client_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_settings_can_view_own" ON "public"."client_settings" USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_settings_insert_own" ON "public"."client_settings" FOR INSERT WITH CHECK ((("client_id" IN ( SELECT "client_members"."client_id"
   FROM "public"."client_members"
  WHERE ("client_members"."user_id" = "auth"."uid"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_settings_select_own" ON "public"."client_settings" FOR SELECT USING ((("client_id" IN ( SELECT "client_members"."client_id"
   FROM "public"."client_members"
  WHERE ("client_members"."user_id" = "auth"."uid"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_settings_service_role" ON "public"."client_settings" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "client_settings_update_own" ON "public"."client_settings" FOR UPDATE USING ((("client_id" IN ( SELECT "client_members"."client_id"
   FROM "public"."client_members"
  WHERE ("client_members"."user_id" = "auth"."uid"()))) OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."client_webhooks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_webhooks_all_authenticated" ON "public"."client_webhooks" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "client_webhooks_can_view_own" ON "public"."client_webhooks" USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_webhooks_delete_own" ON "public"."client_webhooks" FOR DELETE USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_webhooks_insert_own" ON "public"."client_webhooks" FOR INSERT WITH CHECK ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_webhooks_select_own" ON "public"."client_webhooks" FOR SELECT USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "client_webhooks_service_role" ON "public"."client_webhooks" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "client_webhooks_update_own" ON "public"."client_webhooks" FOR UPDATE USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_can_view_own" ON "public"."clients" FOR SELECT USING (("id" = "public"."client_id"()));



CREATE POLICY "clients_select_own" ON "public"."clients" FOR SELECT USING ((("id" = "auth"."uid"()) OR ("owner_email" = ("auth"."jwt"() ->> 'email'::"text")) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "clients_service_role" ON "public"."clients" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "companies_can_view_own" ON "public"."companies" USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "brand_profiles"."id"
   FROM "public"."brand_profiles"
  WHERE ("brand_profiles"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "companies_service_role" ON "public"."companies" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."daily_send_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_send_tracker" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dead_letter_queue" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dead_letter_queue_all_authenticated" ON "public"."dead_letter_queue" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "dead_letter_queue_can_view_own" ON "public"."dead_letter_queue" USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "dead_letter_queue_select_own" ON "public"."dead_letter_queue" FOR SELECT USING ((("client_id" = "public"."client_id"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "dead_letter_queue_service_role" ON "public"."dead_letter_queue" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."dead_letters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discovered_companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "discovered_companies_can_view_own" ON "public"."discovered_companies" USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "brand_profiles"."id"
   FROM "public"."brand_profiles"
  WHERE ("brand_profiles"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "discovered_companies_insert_own" ON "public"."discovered_companies" FOR INSERT WITH CHECK ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "discovered_companies_select_own" ON "public"."discovered_companies" FOR SELECT USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "discovered_companies_service_role" ON "public"."discovered_companies" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "discovered_companies_update_own" ON "public"."discovered_companies" FOR UPDATE USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."discovered_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "discovered_contacts_all_authenticated" ON "public"."discovered_contacts" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "discovered_contacts_can_view_own" ON "public"."discovered_contacts" USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "brand_profiles"."id"
   FROM "public"."brand_profiles"
  WHERE ("brand_profiles"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "discovered_contacts_insert_own" ON "public"."discovered_contacts" FOR INSERT WITH CHECK ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "discovered_contacts_select_own" ON "public"."discovered_contacts" FOR SELECT USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "discovered_contacts_service_role" ON "public"."discovered_contacts" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "discovered_contacts_update_own" ON "public"."discovered_contacts" FOR UPDATE USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."discovery_dead_letters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discovery_embeddings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discovery_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discovery_query_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discovery_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."domain_filters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."edge_function_secrets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_events_service_role" ON "public"."email_events" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."enrichment_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inbound_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inbound_message_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_company_map" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_import_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leads_can_view_own" ON "public"."leads" USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "brand_profiles"."id"
   FROM "public"."brand_profiles"
  WHERE ("brand_profiles"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "leads_delete_own" ON "public"."leads" FOR DELETE USING ((("client_id" IN ( SELECT "client_members"."client_id"
   FROM "public"."client_members"
  WHERE ("client_members"."user_id" = "auth"."uid"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "leads_insert_own" ON "public"."leads" FOR INSERT WITH CHECK ((("client_id" IN ( SELECT "client_members"."client_id"
   FROM "public"."client_members"
  WHERE ("client_members"."user_id" = "auth"."uid"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "leads_select_own" ON "public"."leads" FOR SELECT USING ((("client_id" IN ( SELECT "client_members"."client_id"
   FROM "public"."client_members"
  WHERE ("client_members"."user_id" = "auth"."uid"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "leads_service_role" ON "public"."leads" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "leads_update_own" ON "public"."leads" FOR UPDATE USING ((("client_id" IN ( SELECT "client_members"."client_id"
   FROM "public"."client_members"
  WHERE ("client_members"."user_id" = "auth"."uid"()))) OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."negotiation_drafts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_preferences_own_user" ON "public"."notification_preferences" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."opportunities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."outbound_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."outreach" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pre_validation_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."qualification" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."replies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "replies_all_authenticated" ON "public"."replies" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "replies_can_view_own" ON "public"."replies" USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "brand_profiles"."id"
   FROM "public"."brand_profiles"
  WHERE ("brand_profiles"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "replies_insert_own" ON "public"."replies" FOR INSERT WITH CHECK ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "replies_select_own" ON "public"."replies" FOR SELECT USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "replies_service_role" ON "public"."replies" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "replies_update_own" ON "public"."replies" FOR UPDATE USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."research" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scoring_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."send_counters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "send_counters_all_authenticated" ON "public"."send_counters" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "send_counters_can_view_own" ON "public"."send_counters" FOR SELECT USING ((("brand_id" IN ( SELECT "brand_profiles"."id"
   FROM "public"."brand_profiles"
  WHERE ("brand_profiles"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "send_counters_select_own" ON "public"."send_counters" FOR SELECT USING ((("brand_id" IN ( SELECT "bp"."id"
   FROM "public"."brand_profiles" "bp"
  WHERE ("bp"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "send_counters_service_role" ON "public"."send_counters" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."sending_domains" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sent_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sent_messages_can_view_own" ON "public"."sent_messages" USING ((("client_id" = "public"."client_id"()) OR ("brand_id" IN ( SELECT "brand_profiles"."id"
   FROM "public"."brand_profiles"
  WHERE ("brand_profiles"."client_id" = "public"."client_id"()))) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "sent_messages_service_role" ON "public"."sent_messages" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."brand_profiles" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service role full access" ON "public"."companies" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_api_quota_counters" ON "public"."api_quota_counters" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_brand_profiles_backup" ON "public"."brand_profiles_backup" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_daily_send_limits" ON "public"."daily_send_limits" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_daily_send_tracker" ON "public"."daily_send_tracker" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_dead_letters" ON "public"."dead_letters" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_discovery_dead_letters" ON "public"."discovery_dead_letters" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_discovery_metrics" ON "public"."discovery_metrics" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_discovery_sources" ON "public"."discovery_sources" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_edge_function_secrets" ON "public"."edge_function_secrets" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_enrichment_metrics" ON "public"."enrichment_metrics" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_inbound_events" ON "public"."inbound_events" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_inbound_message_claims" ON "public"."inbound_message_claims" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_lead_company_map" ON "public"."lead_company_map" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_lead_import_batches" ON "public"."lead_import_batches" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_messages" ON "public"."messages" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_negotiation_drafts" ON "public"."negotiation_drafts" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_outbound_events" ON "public"."outbound_events" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_outreach" ON "public"."outreach" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_qualification" ON "public"."qualification" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_research" ON "public"."research" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_scoring_versions" ON "public"."scoring_versions" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_sending_domains" ON "public"."sending_domains" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_signal_performance" ON "public"."signal_performance" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_signal_source_performance" ON "public"."signal_source_performance" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_system_flags" ON "public"."system_flags" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_all_system_health" ON "public"."system_health" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access" ON "public"."api_rate_limit" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access" ON "public"."api_usage_logs" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access" ON "public"."audit_logs" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access" ON "public"."circuit_breaker_state" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access" ON "public"."client_api_keys" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access" ON "public"."client_daily_send" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access" ON "public"."client_hourly_send" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access" ON "public"."client_webhooks" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access" ON "public"."email_events" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access" ON "public"."sent_messages" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access" ON "public"."suppression_list" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "service_role_full_access" ON "public"."webhook_deliveries" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."signal_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."signal_performance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."signal_source_performance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."source_precision" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppression_list" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "suppression_list_all" ON "public"."suppression_list" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."system_flags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_flags_all_authenticated" ON "public"."system_flags" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."system_health" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."validation_feedback_loop" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_deliveries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "webhook_deliveries_service_role" ON "public"."webhook_deliveries" USING (("auth"."role"() = 'service_role'::"text"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."citextin"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."citextin"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."citextin"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citextin"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."citextout"("public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citextout"("public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citextout"("public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citextout"("public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citextrecv"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."citextrecv"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."citextrecv"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citextrecv"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."citextsend"("public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citextsend"("public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citextsend"("public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citextsend"("public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."citext"(boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."citext"(boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."citext"(boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext"(boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."citext"(character) TO "postgres";
GRANT ALL ON FUNCTION "public"."citext"(character) TO "anon";
GRANT ALL ON FUNCTION "public"."citext"(character) TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext"(character) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."citext"("inet") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext"("inet") TO "anon";
GRANT ALL ON FUNCTION "public"."citext"("inet") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext"("inet") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "service_role";


























































































































































































GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_api_key_rate_limit"("p_api_key_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_api_key_rate_limit"("p_api_key_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_api_key_rate_limit"("p_api_key_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_client_send_quota"("p_client_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_client_send_quota"("p_client_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_client_send_quota"("p_client_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_cmp"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_cmp"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_cmp"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_cmp"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_eq"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_eq"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_eq"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_eq"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_ge"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_ge"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_ge"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_ge"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_gt"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_gt"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_gt"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_gt"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_hash"("public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_hash"("public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_hash"("public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_hash"("public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_hash_extended"("public"."citext", bigint) TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_hash_extended"("public"."citext", bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."citext_hash_extended"("public"."citext", bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_hash_extended"("public"."citext", bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_larger"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_larger"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_larger"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_larger"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_le"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_le"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_le"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_le"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_lt"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_lt"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_lt"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_lt"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_ne"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_ne"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_ne"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_ne"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_pattern_cmp"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_pattern_cmp"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_pattern_cmp"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_pattern_cmp"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_pattern_ge"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_pattern_ge"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_pattern_ge"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_pattern_ge"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_pattern_gt"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_pattern_gt"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_pattern_gt"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_pattern_gt"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_pattern_le"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_pattern_le"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_pattern_le"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_pattern_le"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_pattern_lt"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_pattern_lt"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_pattern_lt"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_pattern_lt"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."citext_smaller"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."citext_smaller"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."citext_smaller"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."citext_smaller"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON TABLE "public"."discovered_companies" TO "anon";
GRANT ALL ON TABLE "public"."discovered_companies" TO "authenticated";
GRANT ALL ON TABLE "public"."discovered_companies" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_companies_for_enrichment"("p_brand_id" "uuid", "p_batch_size" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_companies_for_enrichment"("p_brand_id" "uuid", "p_batch_size" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_companies_for_enrichment"("p_brand_id" "uuid", "p_batch_size" integer) TO "service_role";



GRANT ALL ON TABLE "public"."discovered_contacts" TO "anon";
GRANT ALL ON TABLE "public"."discovered_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."discovered_contacts" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_contacts_for_enrichment"("p_brand_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_contacts_for_enrichment"("p_brand_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_contacts_for_enrichment"("p_brand_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_audit_logs"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_audit_logs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_audit_logs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."client_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."client_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."client_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."consume_client_send_quota"("p_client_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."consume_client_send_quota"("p_client_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."consume_client_send_quota"("p_client_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."consume_send_quota"("p_brand_id" "uuid", "p_domain" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."consume_send_quota"("p_brand_id" "uuid", "p_domain" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."consume_send_quota"("p_brand_id" "uuid", "p_domain" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."detect_stuck_leads"() TO "anon";
GRANT ALL ON FUNCTION "public"."detect_stuck_leads"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."detect_stuck_leads"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fix_client_member_user_id"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fix_client_member_user_id"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fix_client_member_user_id"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_outreach_from_leads"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_outreach_from_leads"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_outreach_from_leads"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_brand_credentials"("p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_brand_credentials"("p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_brand_credentials"("p_brand_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_client_credentials"("p_client_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_client_credentials"("p_client_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_client_credentials"("p_client_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_cors_headers"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_cors_headers"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_cors_headers"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_domain_health"("p_brand_id" "uuid", "p_domain" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_domain_health"("p_brand_id" "uuid", "p_domain" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_domain_health"("p_brand_id" "uuid", "p_domain" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_edge_secret"("p_key_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_edge_secret"("p_key_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_edge_secret"("p_key_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_send_quota_status"("p_brand_id" "uuid", "p_domain" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_send_quota_status"("p_brand_id" "uuid", "p_domain" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_send_quota_status"("p_brand_id" "uuid", "p_domain" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_client"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_client"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_client"() TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_discovery_counter"("p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_discovery_counter"("p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_discovery_counter"("p_brand_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_query_approved_count"("p_run_id" "uuid", "p_brand_id" "uuid", "p_domain" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_query_approved_count"("p_run_id" "uuid", "p_brand_id" "uuid", "p_domain" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_query_approved_count"("p_run_id" "uuid", "p_brand_id" "uuid", "p_domain" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_api_usage"("p_client_id" "uuid", "p_api_key_id" "uuid", "p_endpoint" "text", "p_method" "text", "p_status_code" integer, "p_response_time_ms" integer, "p_rate_limited" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."log_api_usage"("p_client_id" "uuid", "p_api_key_id" "uuid", "p_endpoint" "text", "p_method" "text", "p_status_code" integer, "p_response_time_ms" integer, "p_rate_limited" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_api_usage"("p_client_id" "uuid", "p_api_key_id" "uuid", "p_endpoint" "text", "p_method" "text", "p_status_code" integer, "p_response_time_ms" integer, "p_rate_limited" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit"("p_client_id" "uuid", "p_actor_id" "text", "p_actor_email" "text", "p_action" "text", "p_resource_type" "text", "p_resource_id" "text", "p_changes" "jsonb", "p_metadata" "jsonb", "p_ip_address" "inet") TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit"("p_client_id" "uuid", "p_actor_id" "text", "p_actor_email" "text", "p_action" "text", "p_resource_type" "text", "p_resource_id" "text", "p_changes" "jsonb", "p_metadata" "jsonb", "p_ip_address" "inet") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit"("p_client_id" "uuid", "p_actor_id" "text", "p_actor_email" "text", "p_action" "text", "p_resource_type" "text", "p_resource_id" "text", "p_changes" "jsonb", "p_metadata" "jsonb", "p_ip_address" "inet") TO "service_role";



GRANT ALL ON FUNCTION "public"."match_discovery_embeddings"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "filter_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."match_discovery_embeddings"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "filter_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_discovery_embeddings"("query_embedding" "public"."vector", "match_threshold" double precision, "match_count" integer, "filter_brand_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."move_enriched_to_companies"() TO "anon";
GRANT ALL ON FUNCTION "public"."move_enriched_to_companies"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."move_enriched_to_companies"() TO "service_role";



GRANT ALL ON FUNCTION "public"."regexp_match"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."regexp_match"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."regexp_match"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."regexp_match"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."regexp_match"("public"."citext", "public"."citext", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."regexp_match"("public"."citext", "public"."citext", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."regexp_match"("public"."citext", "public"."citext", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."regexp_match"("public"."citext", "public"."citext", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."regexp_matches"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."regexp_matches"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."regexp_matches"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."regexp_matches"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."regexp_matches"("public"."citext", "public"."citext", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."regexp_matches"("public"."citext", "public"."citext", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."regexp_matches"("public"."citext", "public"."citext", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."regexp_matches"("public"."citext", "public"."citext", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."regexp_replace"("public"."citext", "public"."citext", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."regexp_replace"("public"."citext", "public"."citext", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."regexp_replace"("public"."citext", "public"."citext", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."regexp_replace"("public"."citext", "public"."citext", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."regexp_replace"("public"."citext", "public"."citext", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."regexp_replace"("public"."citext", "public"."citext", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."regexp_replace"("public"."citext", "public"."citext", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."regexp_replace"("public"."citext", "public"."citext", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."regexp_split_to_array"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."regexp_split_to_array"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."regexp_split_to_array"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."regexp_split_to_array"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."regexp_split_to_array"("public"."citext", "public"."citext", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."regexp_split_to_array"("public"."citext", "public"."citext", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."regexp_split_to_array"("public"."citext", "public"."citext", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."regexp_split_to_array"("public"."citext", "public"."citext", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."regexp_split_to_table"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."regexp_split_to_table"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."regexp_split_to_table"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."regexp_split_to_table"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."regexp_split_to_table"("public"."citext", "public"."citext", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."regexp_split_to_table"("public"."citext", "public"."citext", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."regexp_split_to_table"("public"."citext", "public"."citext", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."regexp_split_to_table"("public"."citext", "public"."citext", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."register_bounce"("p_brand_id" "uuid", "p_domain" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."register_bounce"("p_brand_id" "uuid", "p_domain" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_bounce"("p_brand_id" "uuid", "p_domain" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."register_client_bounce"("p_client_id" "uuid", "p_is_hard" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."register_client_bounce"("p_client_id" "uuid", "p_is_hard" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_client_bounce"("p_client_id" "uuid", "p_is_hard" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."register_domain_bounce"("p_brand_id" "uuid", "p_domain" "text", "p_is_hard" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."register_domain_bounce"("p_brand_id" "uuid", "p_domain" "text", "p_is_hard" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_domain_bounce"("p_brand_id" "uuid", "p_domain" "text", "p_is_hard" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."replace"("public"."citext", "public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."replace"("public"."citext", "public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."replace"("public"."citext", "public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace"("public"."citext", "public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."reserve_send_quota"("p_brand_id" "uuid", "p_domain" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reserve_send_quota"("p_brand_id" "uuid", "p_domain" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_send_quota"("p_brand_id" "uuid", "p_domain" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reset_discovery_counters"() TO "anon";
GRANT ALL ON FUNCTION "public"."reset_discovery_counters"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_discovery_counters"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_activate_scoring_version"("p_version_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_activate_scoring_version"("p_version_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_activate_scoring_version"("p_version_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_adjust_scoring_weights"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_adjust_scoring_weights"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_adjust_scoring_weights"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_backfill_member_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_backfill_member_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_backfill_member_user_id"() TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_claim_companies"("p_brand_id" "uuid", "p_status" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_claim_companies"("p_brand_id" "uuid", "p_status" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_claim_companies"("p_brand_id" "uuid", "p_status" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_claim_discovered_companies"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_claim_discovered_companies"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_claim_discovered_companies"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_claim_discovered_contacts"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_claim_discovered_contacts"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_claim_discovered_contacts"("p_limit" integer) TO "service_role";



GRANT ALL ON TABLE "public"."brand_discovery_sources" TO "anon";
GRANT ALL ON TABLE "public"."brand_discovery_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_discovery_sources" TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_claim_discovery_sources"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_claim_discovery_sources"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_claim_discovery_sources"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_claim_inbound_message"("p_message_id" "text", "p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_claim_inbound_message"("p_message_id" "text", "p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_claim_inbound_message"("p_message_id" "text", "p_brand_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."outreach" TO "anon";
GRANT ALL ON TABLE "public"."outreach" TO "authenticated";
GRANT ALL ON TABLE "public"."outreach" TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_claim_outreach_draft"("p_company_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_claim_outreach_draft"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_claim_outreach_draft"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_close_company"("p_company_id" "uuid", "p_deal_value" numeric, "p_currency" "text", "p_contract_length" integer, "p_payment_model" "text", "p_gross_margin" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_close_company"("p_company_id" "uuid", "p_deal_value" numeric, "p_currency" "text", "p_contract_length" integer, "p_payment_model" "text", "p_gross_margin" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_close_company"("p_company_id" "uuid", "p_deal_value" numeric, "p_currency" "text", "p_contract_length" integer, "p_payment_model" "text", "p_gross_margin" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_complete_discovered_company"("p_id" "uuid", "p_success" boolean, "p_error" "text", "p_requires_enrichment" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_complete_discovered_company"("p_id" "uuid", "p_success" boolean, "p_error" "text", "p_requires_enrichment" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_complete_discovered_company"("p_id" "uuid", "p_success" boolean, "p_error" "text", "p_requires_enrichment" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_complete_discovered_contact"("p_id" "uuid", "p_success" boolean, "p_error" "text", "p_requires_enrichment" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_complete_discovered_contact"("p_id" "uuid", "p_success" boolean, "p_error" "text", "p_requires_enrichment" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_complete_discovered_contact"("p_id" "uuid", "p_success" boolean, "p_error" "text", "p_requires_enrichment" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_consume_api_quota"("p_source_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_consume_api_quota"("p_source_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_consume_api_quota"("p_source_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_create_company_from_lead"("p_lead_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_create_company_from_lead"("p_lead_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_create_company_from_lead"("p_lead_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_active_brands"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_active_brands"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_active_brands"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_imap_brands"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_imap_brands"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_imap_brands"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_source_precision"("p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_source_precision"("p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_source_precision"("p_brand_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_get_validation_report"("p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_get_validation_report"("p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_get_validation_report"("p_brand_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_increment_company_retry"("p_id" "uuid", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_increment_company_retry"("p_id" "uuid", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_increment_company_retry"("p_id" "uuid", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_increment_domain_metric"("p_product" "uuid", "p_metric" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_increment_domain_metric"("p_product" "uuid", "p_metric" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_increment_domain_metric"("p_product" "uuid", "p_metric" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_ingest_lead"("p_brand_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_title" "text", "p_company_name" "text", "p_domain" "text", "p_linkedin_url" "text", "p_source" "text", "p_source_id" "text", "p_raw_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_ingest_lead"("p_brand_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_title" "text", "p_company_name" "text", "p_domain" "text", "p_linkedin_url" "text", "p_source" "text", "p_source_id" "text", "p_raw_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_ingest_lead"("p_brand_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_title" "text", "p_company_name" "text", "p_domain" "text", "p_linkedin_url" "text", "p_source" "text", "p_source_id" "text", "p_raw_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_ingest_lead"("p_brand_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_title" "text", "p_company_name" "text", "p_domain" "text", "p_linkedin_url" "text", "p_source" "text", "p_source_id" "text", "p_raw_payload" "jsonb", "p_client_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_ingest_lead"("p_brand_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_title" "text", "p_company_name" "text", "p_domain" "text", "p_linkedin_url" "text", "p_source" "text", "p_source_id" "text", "p_raw_payload" "jsonb", "p_client_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_ingest_lead"("p_brand_id" "uuid", "p_first_name" "text", "p_last_name" "text", "p_full_name" "text", "p_email" "text", "p_title" "text", "p_company_name" "text", "p_domain" "text", "p_linkedin_url" "text", "p_source" "text", "p_source_id" "text", "p_raw_payload" "jsonb", "p_client_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_insert_negotiation_draft"("p_company_id" "uuid", "p_draft" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_insert_negotiation_draft"("p_company_id" "uuid", "p_draft" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_insert_negotiation_draft"("p_company_id" "uuid", "p_draft" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_insert_reply"("p_company_id" "uuid", "p_lead_id" "uuid", "p_message_id" "text", "p_body" "text", "p_subject" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_insert_reply"("p_company_id" "uuid", "p_lead_id" "uuid", "p_message_id" "text", "p_body" "text", "p_subject" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_insert_reply"("p_company_id" "uuid", "p_lead_id" "uuid", "p_message_id" "text", "p_body" "text", "p_subject" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_is_blacklisted"("p_email" "text", "p_domain" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_is_blacklisted"("p_email" "text", "p_domain" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_is_blacklisted"("p_email" "text", "p_domain" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_mark_lead_contacted"("p_lead_id" "uuid", "p_subject" "text", "p_body" "text", "p_message_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_mark_lead_contacted"("p_lead_id" "uuid", "p_subject" "text", "p_body" "text", "p_message_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_mark_lead_contacted"("p_lead_id" "uuid", "p_subject" "text", "p_body" "text", "p_message_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_recalibrate_lead_confidence"("p_lead_id" "uuid", "p_new_confidence" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_recalibrate_lead_confidence"("p_lead_id" "uuid", "p_new_confidence" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_recalibrate_lead_confidence"("p_lead_id" "uuid", "p_new_confidence" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_reclaim_stale_companies"("p_brand_id" "uuid", "p_processing_status" "text", "p_timeout_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_reclaim_stale_companies"("p_brand_id" "uuid", "p_processing_status" "text", "p_timeout_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_reclaim_stale_companies"("p_brand_id" "uuid", "p_processing_status" "text", "p_timeout_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_record_source_precision"("p_source_name" "text", "p_brand_id" "uuid", "p_signal_type" "text", "p_end_client" boolean, "p_false_positive" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_record_source_precision"("p_source_name" "text", "p_brand_id" "uuid", "p_signal_type" "text", "p_end_client" boolean, "p_false_positive" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_record_source_precision"("p_source_name" "text", "p_brand_id" "uuid", "p_signal_type" "text", "p_end_client" boolean, "p_false_positive" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_record_validation_outcome"("p_brand_id" "uuid", "p_company_name" "text", "p_domain" "text", "p_overall_confidence" numeric, "p_accepted" boolean, "p_converted" boolean, "p_dimension_scores" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_record_validation_outcome"("p_brand_id" "uuid", "p_company_name" "text", "p_domain" "text", "p_overall_confidence" numeric, "p_accepted" boolean, "p_converted" boolean, "p_dimension_scores" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_record_validation_outcome"("p_brand_id" "uuid", "p_company_name" "text", "p_domain" "text", "p_overall_confidence" numeric, "p_accepted" boolean, "p_converted" boolean, "p_dimension_scores" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_register_failure"("p_entity_type" "text", "p_entity_id" "uuid", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_register_failure"("p_entity_type" "text", "p_entity_id" "uuid", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_register_failure"("p_entity_type" "text", "p_entity_id" "uuid", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_release_discovery_source"("p_source_id" "uuid", "p_success" boolean, "p_error" "text", "p_companies" integer, "p_contacts" integer, "p_duration_ms" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_release_discovery_source"("p_source_id" "uuid", "p_success" boolean, "p_error" "text", "p_companies" integer, "p_contacts" integer, "p_duration_ms" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_release_discovery_source"("p_source_id" "uuid", "p_success" boolean, "p_error" "text", "p_companies" integer, "p_contacts" integer, "p_duration_ms" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_request_manual_discovery"("p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_request_manual_discovery"("p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_request_manual_discovery"("p_brand_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_reserve_daily_send"("p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_reserve_daily_send"("p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_reserve_daily_send"("p_brand_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_reserve_hourly_send"("p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_reserve_hourly_send"("p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_reserve_hourly_send"("p_brand_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_score_lead"("p_lead_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_score_lead"("p_lead_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_score_lead"("p_lead_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_brand_deliverability"("p_brand_id" "uuid", "p_score" numeric, "p_auto_pause" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_brand_deliverability"("p_brand_id" "uuid", "p_score" numeric, "p_auto_pause" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_brand_deliverability"("p_brand_id" "uuid", "p_score" numeric, "p_auto_pause" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_company_status"("p_brand_id" "uuid", "p_company_id" "uuid", "p_expected_status" "text", "p_new_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_company_status"("p_brand_id" "uuid", "p_company_id" "uuid", "p_expected_status" "text", "p_new_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_company_status"("p_brand_id" "uuid", "p_company_id" "uuid", "p_expected_status" "text", "p_new_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_lead_status"("p_lead_id" "uuid", "p_new_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_lead_status"("p_lead_id" "uuid", "p_new_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_lead_status"("p_lead_id" "uuid", "p_new_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_signal_performance_for_company"("p_company_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_signal_performance_for_company"("p_company_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_signal_performance_for_company"("p_company_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpc_update_signal_source_performance"("p_brand_id" "uuid", "p_source_id" "uuid", "p_send_delta" integer, "p_reply_delta" integer, "p_bounce_delta" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rpc_update_signal_source_performance"("p_brand_id" "uuid", "p_source_id" "uuid", "p_send_delta" integer, "p_reply_delta" integer, "p_bounce_delta" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpc_update_signal_source_performance"("p_brand_id" "uuid", "p_source_id" "uuid", "p_send_delta" integer, "p_reply_delta" integer, "p_bounce_delta" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."schedule_retry"("p_lead_id" "uuid", "p_error" "text", "p_max_attempts" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."schedule_retry"("p_lead_id" "uuid", "p_error" "text", "p_max_attempts" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."schedule_retry"("p_lead_id" "uuid", "p_error" "text", "p_max_attempts" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."score_leads_after_enrichment"() TO "anon";
GRANT ALL ON FUNCTION "public"."score_leads_after_enrichment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."score_leads_after_enrichment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_discovered_companies_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_discovered_companies_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_discovered_companies_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."split_part"("public"."citext", "public"."citext", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."split_part"("public"."citext", "public"."citext", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."split_part"("public"."citext", "public"."citext", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."split_part"("public"."citext", "public"."citext", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."strpos"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."strpos"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."strpos"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strpos"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."texticlike"("public"."citext", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."texticlike"("public"."citext", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."texticlike"("public"."citext", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."texticlike"("public"."citext", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."texticlike"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."texticlike"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."texticlike"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."texticlike"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."texticnlike"("public"."citext", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."texticnlike"("public"."citext", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."texticnlike"("public"."citext", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."texticnlike"("public"."citext", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."texticnlike"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."texticnlike"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."texticnlike"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."texticnlike"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."texticregexeq"("public"."citext", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."texticregexeq"("public"."citext", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."texticregexeq"("public"."citext", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."texticregexeq"("public"."citext", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."texticregexeq"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."texticregexeq"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."texticregexeq"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."texticregexeq"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."texticregexne"("public"."citext", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."texticregexne"("public"."citext", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."texticregexne"("public"."citext", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."texticregexne"("public"."citext", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."texticregexne"("public"."citext", "public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."texticregexne"("public"."citext", "public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."texticregexne"("public"."citext", "public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."texticregexne"("public"."citext", "public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."translate"("public"."citext", "public"."citext", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."translate"("public"."citext", "public"."citext", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."translate"("public"."citext", "public"."citext", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."translate"("public"."citext", "public"."citext", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_create_company_from_lead"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_create_company_from_lead"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_create_company_from_lead"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_company_enrichment"("p_company_id" "uuid", "p_status" "text", "p_enrichment_data" "jsonb", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_company_enrichment"("p_company_id" "uuid", "p_status" "text", "p_enrichment_data" "jsonb", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_company_enrichment"("p_company_id" "uuid", "p_status" "text", "p_enrichment_data" "jsonb", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_company_enrichment"("p_company_id" "uuid", "p_confidence" numeric, "p_company_name" "text", "p_website" "text", "p_domain" "text", "p_status" "text", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_company_enrichment"("p_company_id" "uuid", "p_confidence" numeric, "p_company_name" "text", "p_website" "text", "p_domain" "text", "p_status" "text", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_company_enrichment"("p_company_id" "uuid", "p_confidence" numeric, "p_company_name" "text", "p_website" "text", "p_domain" "text", "p_status" "text", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_contact_enrichment"("p_contact_id" "uuid", "p_confidence" numeric, "p_email" "text", "p_title" "text", "p_linkedin_url" "text", "p_intent_score" numeric, "p_status" "text", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_contact_enrichment"("p_contact_id" "uuid", "p_confidence" numeric, "p_email" "text", "p_title" "text", "p_linkedin_url" "text", "p_intent_score" numeric, "p_status" "text", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_contact_enrichment"("p_contact_id" "uuid", "p_confidence" numeric, "p_email" "text", "p_title" "text", "p_linkedin_url" "text", "p_intent_score" numeric, "p_status" "text", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_contact_enrichment"("p_contact_id" "uuid", "p_email" "text", "p_confidence" numeric, "p_status" "text", "p_requires_enrichment" boolean, "p_source" "text", "p_reasoning" "jsonb", "p_error" "text", "p_intent_score" numeric, "p_linkedin_url" "text", "p_title" "text", "p_attempts" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."update_contact_enrichment"("p_contact_id" "uuid", "p_email" "text", "p_confidence" numeric, "p_status" "text", "p_requires_enrichment" boolean, "p_source" "text", "p_reasoning" "jsonb", "p_error" "text", "p_intent_score" numeric, "p_linkedin_url" "text", "p_title" "text", "p_attempts" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_contact_enrichment"("p_contact_id" "uuid", "p_email" "text", "p_confidence" numeric, "p_status" "text", "p_requires_enrichment" boolean, "p_source" "text", "p_reasoning" "jsonb", "p_error" "text", "p_intent_score" numeric, "p_linkedin_url" "text", "p_title" "text", "p_attempts" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "service_role";












GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."max"("public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."max"("public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."max"("public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."max"("public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."min"("public"."citext") TO "postgres";
GRANT ALL ON FUNCTION "public"."min"("public"."citext") TO "anon";
GRANT ALL ON FUNCTION "public"."min"("public"."citext") TO "authenticated";
GRANT ALL ON FUNCTION "public"."min"("public"."citext") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "service_role";















GRANT ALL ON TABLE "public"."activity_logs" TO "anon";
GRANT ALL ON TABLE "public"."activity_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_logs" TO "service_role";



GRANT ALL ON TABLE "public"."adapter_config" TO "anon";
GRANT ALL ON TABLE "public"."adapter_config" TO "authenticated";
GRANT ALL ON TABLE "public"."adapter_config" TO "service_role";



GRANT ALL ON TABLE "public"."api_quota_counters" TO "anon";
GRANT ALL ON TABLE "public"."api_quota_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."api_quota_counters" TO "service_role";



GRANT ALL ON TABLE "public"."api_rate_limit" TO "anon";
GRANT ALL ON TABLE "public"."api_rate_limit" TO "authenticated";
GRANT ALL ON TABLE "public"."api_rate_limit" TO "service_role";



GRANT ALL ON TABLE "public"."api_usage_logs" TO "anon";
GRANT ALL ON TABLE "public"."api_usage_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."api_usage_logs" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."blacklist" TO "anon";
GRANT ALL ON TABLE "public"."blacklist" TO "authenticated";
GRANT ALL ON TABLE "public"."blacklist" TO "service_role";



GRANT ALL ON TABLE "public"."brand_intents" TO "anon";
GRANT ALL ON TABLE "public"."brand_intents" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_intents" TO "service_role";



GRANT ALL ON TABLE "public"."brand_profiles" TO "anon";
GRANT ALL ON TABLE "public"."brand_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."brand_profiles_backup" TO "anon";
GRANT ALL ON TABLE "public"."brand_profiles_backup" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_profiles_backup" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_analytics" TO "anon";
GRANT ALL ON TABLE "public"."campaign_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_analytics" TO "service_role";



GRANT ALL ON TABLE "public"."circuit_breaker_state" TO "anon";
GRANT ALL ON TABLE "public"."circuit_breaker_state" TO "authenticated";
GRANT ALL ON TABLE "public"."circuit_breaker_state" TO "service_role";



GRANT ALL ON TABLE "public"."client_api_keys" TO "anon";
GRANT ALL ON TABLE "public"."client_api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."client_api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."client_daily_send" TO "anon";
GRANT ALL ON TABLE "public"."client_daily_send" TO "authenticated";
GRANT ALL ON TABLE "public"."client_daily_send" TO "service_role";



GRANT ALL ON TABLE "public"."client_hourly_send" TO "anon";
GRANT ALL ON TABLE "public"."client_hourly_send" TO "authenticated";
GRANT ALL ON TABLE "public"."client_hourly_send" TO "service_role";



GRANT ALL ON TABLE "public"."client_members" TO "anon";
GRANT ALL ON TABLE "public"."client_members" TO "authenticated";
GRANT ALL ON TABLE "public"."client_members" TO "service_role";



GRANT ALL ON TABLE "public"."client_settings" TO "anon";
GRANT ALL ON TABLE "public"."client_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."client_settings" TO "service_role";



GRANT ALL ON TABLE "public"."client_webhooks" TO "anon";
GRANT ALL ON TABLE "public"."client_webhooks" TO "authenticated";
GRANT ALL ON TABLE "public"."client_webhooks" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."daily_send_limits" TO "anon";
GRANT ALL ON TABLE "public"."daily_send_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_send_limits" TO "service_role";



GRANT ALL ON TABLE "public"."daily_send_tracker" TO "anon";
GRANT ALL ON TABLE "public"."daily_send_tracker" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_send_tracker" TO "service_role";



GRANT ALL ON TABLE "public"."dead_letter_queue" TO "anon";
GRANT ALL ON TABLE "public"."dead_letter_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."dead_letter_queue" TO "service_role";



GRANT ALL ON TABLE "public"."dead_letters" TO "anon";
GRANT ALL ON TABLE "public"."dead_letters" TO "authenticated";
GRANT ALL ON TABLE "public"."dead_letters" TO "service_role";



GRANT ALL ON TABLE "public"."discovery_dead_letters" TO "anon";
GRANT ALL ON TABLE "public"."discovery_dead_letters" TO "authenticated";
GRANT ALL ON TABLE "public"."discovery_dead_letters" TO "service_role";



GRANT ALL ON TABLE "public"."discovery_embeddings" TO "anon";
GRANT ALL ON TABLE "public"."discovery_embeddings" TO "authenticated";
GRANT ALL ON TABLE "public"."discovery_embeddings" TO "service_role";



GRANT ALL ON TABLE "public"."discovery_metrics" TO "anon";
GRANT ALL ON TABLE "public"."discovery_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."discovery_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."discovery_query_log" TO "anon";
GRANT ALL ON TABLE "public"."discovery_query_log" TO "authenticated";
GRANT ALL ON TABLE "public"."discovery_query_log" TO "service_role";



GRANT ALL ON TABLE "public"."discovery_sources" TO "anon";
GRANT ALL ON TABLE "public"."discovery_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."discovery_sources" TO "service_role";



GRANT ALL ON TABLE "public"."domain_filters" TO "anon";
GRANT ALL ON TABLE "public"."domain_filters" TO "authenticated";
GRANT ALL ON TABLE "public"."domain_filters" TO "service_role";



GRANT ALL ON TABLE "public"."edge_function_secrets" TO "anon";
GRANT ALL ON TABLE "public"."edge_function_secrets" TO "authenticated";
GRANT ALL ON TABLE "public"."edge_function_secrets" TO "service_role";



GRANT ALL ON TABLE "public"."email_events" TO "anon";
GRANT ALL ON TABLE "public"."email_events" TO "authenticated";
GRANT ALL ON TABLE "public"."email_events" TO "service_role";



GRANT ALL ON TABLE "public"."enrichment_metrics" TO "anon";
GRANT ALL ON TABLE "public"."enrichment_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."enrichment_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."inbound_events" TO "anon";
GRANT ALL ON TABLE "public"."inbound_events" TO "authenticated";
GRANT ALL ON TABLE "public"."inbound_events" TO "service_role";



GRANT ALL ON TABLE "public"."inbound_message_claims" TO "anon";
GRANT ALL ON TABLE "public"."inbound_message_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."inbound_message_claims" TO "service_role";



GRANT ALL ON TABLE "public"."lead_company_map" TO "anon";
GRANT ALL ON TABLE "public"."lead_company_map" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_company_map" TO "service_role";



GRANT ALL ON TABLE "public"."lead_import_batches" TO "anon";
GRANT ALL ON TABLE "public"."lead_import_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_import_batches" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."negotiation_drafts" TO "anon";
GRANT ALL ON TABLE "public"."negotiation_drafts" TO "authenticated";
GRANT ALL ON TABLE "public"."negotiation_drafts" TO "service_role";



GRANT ALL ON TABLE "public"."notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."opportunities" TO "anon";
GRANT ALL ON TABLE "public"."opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."opportunities" TO "service_role";



GRANT ALL ON TABLE "public"."outbound_events" TO "anon";
GRANT ALL ON TABLE "public"."outbound_events" TO "authenticated";
GRANT ALL ON TABLE "public"."outbound_events" TO "service_role";



GRANT ALL ON TABLE "public"."pre_validation_log" TO "anon";
GRANT ALL ON TABLE "public"."pre_validation_log" TO "authenticated";
GRANT ALL ON TABLE "public"."pre_validation_log" TO "service_role";



GRANT ALL ON TABLE "public"."qualification" TO "anon";
GRANT ALL ON TABLE "public"."qualification" TO "authenticated";
GRANT ALL ON TABLE "public"."qualification" TO "service_role";



GRANT ALL ON TABLE "public"."replies" TO "anon";
GRANT ALL ON TABLE "public"."replies" TO "authenticated";
GRANT ALL ON TABLE "public"."replies" TO "service_role";



GRANT ALL ON TABLE "public"."research" TO "anon";
GRANT ALL ON TABLE "public"."research" TO "authenticated";
GRANT ALL ON TABLE "public"."research" TO "service_role";



GRANT ALL ON TABLE "public"."scoring_versions" TO "anon";
GRANT ALL ON TABLE "public"."scoring_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."scoring_versions" TO "service_role";



GRANT ALL ON TABLE "public"."send_counters" TO "anon";
GRANT ALL ON TABLE "public"."send_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."send_counters" TO "service_role";



GRANT ALL ON TABLE "public"."sending_domains" TO "anon";
GRANT ALL ON TABLE "public"."sending_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."sending_domains" TO "service_role";



GRANT ALL ON TABLE "public"."sent_messages" TO "anon";
GRANT ALL ON TABLE "public"."sent_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."sent_messages" TO "service_role";



GRANT ALL ON TABLE "public"."signal_config" TO "anon";
GRANT ALL ON TABLE "public"."signal_config" TO "authenticated";
GRANT ALL ON TABLE "public"."signal_config" TO "service_role";



GRANT ALL ON TABLE "public"."signal_performance" TO "anon";
GRANT ALL ON TABLE "public"."signal_performance" TO "authenticated";
GRANT ALL ON TABLE "public"."signal_performance" TO "service_role";



GRANT ALL ON TABLE "public"."signal_source_performance" TO "anon";
GRANT ALL ON TABLE "public"."signal_source_performance" TO "authenticated";
GRANT ALL ON TABLE "public"."signal_source_performance" TO "service_role";



GRANT ALL ON TABLE "public"."source_precision" TO "anon";
GRANT ALL ON TABLE "public"."source_precision" TO "authenticated";
GRANT ALL ON TABLE "public"."source_precision" TO "service_role";



GRANT ALL ON TABLE "public"."suppression_list" TO "anon";
GRANT ALL ON TABLE "public"."suppression_list" TO "authenticated";
GRANT ALL ON TABLE "public"."suppression_list" TO "service_role";



GRANT ALL ON TABLE "public"."system_flags" TO "anon";
GRANT ALL ON TABLE "public"."system_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."system_flags" TO "service_role";



GRANT ALL ON TABLE "public"."system_health" TO "anon";
GRANT ALL ON TABLE "public"."system_health" TO "authenticated";
GRANT ALL ON TABLE "public"."system_health" TO "service_role";



GRANT ALL ON TABLE "public"."top_performing_queries" TO "anon";
GRANT ALL ON TABLE "public"."top_performing_queries" TO "authenticated";
GRANT ALL ON TABLE "public"."top_performing_queries" TO "service_role";



GRANT ALL ON TABLE "public"."v_product_revenue_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_product_revenue_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_product_revenue_summary" TO "service_role";



GRANT ALL ON TABLE "public"."v_signal_revenue_analytics" TO "anon";
GRANT ALL ON TABLE "public"."v_signal_revenue_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."v_signal_revenue_analytics" TO "service_role";



GRANT ALL ON TABLE "public"."validation_feedback_loop" TO "anon";
GRANT ALL ON TABLE "public"."validation_feedback_loop" TO "authenticated";
GRANT ALL ON TABLE "public"."validation_feedback_loop" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_deliveries" TO "anon";
GRANT ALL ON TABLE "public"."webhook_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_deliveries" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































