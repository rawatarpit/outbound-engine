import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { z } from "zod";
import pino from "pino";

dotenv.config();

const logger = pino({ level: "info" });

/* =========================================================
   ENV VALIDATION
========================================================= */

const envSchema = z.object({
  SUPABASE_URL: z.string().url().startsWith("https://"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

const env = envSchema.parse(process.env);

/* =========================================================
   SUPABASE CLIENT
========================================================= */

export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    global: {
      headers: { "X-Client-Info": "ai-outbound-engine" },
    },
  },
);

/* =========================================================
   SAFE RPC WRAPPER (HARDENED)
========================================================= */

async function safeRpc<T>(
  fn: string,
  params: Record<string, unknown>,
): Promise<T> {
  const start = Date.now();

  const { data, error } = await supabase.rpc(fn, params);

  if (error) {
    logger.error({ fn, error: error.message }, "RPC failed");
    throw new Error(`RPC ${fn} failed: ${error.message}`);
  }

  logger.debug(
    {
      fn,
      durationMs: Date.now() - start,
      enrichment: fn.includes("enrichment"),
    },
    "RPC executed",
  );

  return data as T;
}

/* =========================================================
   CORE TYPES
========================================================= */

export interface Company {
  id: string;
  brand_id: string;
  domain: string;
  name: string | null;
  status: string;
  lead_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  state_updated_at?: string | null;
  next_attempt_at?: string | null;
}

export interface BrandProfile {
  id: string;
  product: string;
  brand_name: string;
  positioning: string | null;
  core_offer: string | null;
  tone: string | null;
  audience: string | null;
  objection_guidelines: string | null;
  negotiation_style: string | null;

  /* SMTP */
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean;
  smtp_email: string;
  smtp_password: string;

  /* IMAP */
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean;
  imap_email: string;
  imap_password: string;

  /* ============================
     PROVIDER / TRANSPORT
  ============================ */

  provider: "smtp" | "resend" | "ses";
  provider_api_key: string | null;
  sending_domain: string | null;
  webhook_secret: string | null;
  transport_mode: "mailbox" | "api";

  reply_to_email: string | null;
  signature_block: string | null;

  daily_send_limit: number | null;
  hourly_send_limit: number | null;

  llm_model_override: string | null;
  llm_temperature: number | null;

  is_active: boolean;
  is_paused: boolean | null;
  auto_paused: boolean | null;

  imap_enabled: boolean;
  send_enabled: boolean;

  bounce_count: number | null;
  sent_count: number | null;
  complaint_count: number | null;
  deliverability_score: number | null;
  last_deliverability_check: string | null;

  discovery_enabled: boolean;
  discovery_daily_limit: number | null;
  discovery_count_today: number | null;
  last_discovery_date: string | null;
  outbound_enabled: boolean;
  manual_discovery_requested: boolean;

  created_at: string;
}

/* =========================================================
   CLIENT SETTINGS (LLM etc)
/* ========================================================= */

export interface ClientSettings {
  id: string;
  client_id: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean;
  smtp_email: string | null;
  smtp_password: string | null;
  smtp_from_name: string | null;
  smtp_from_email: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean;
  imap_email: string | null;
  imap_password: string | null;
  imap_enabled: boolean;
  email_provider: string;
  provider_api_key: string | null;
  sending_domain: string | null;
  webhook_secret: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  llm_temperature: number | null;
  llm_base_url: string | null;
  llm_api_key: string | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OutreachDraft {
  id: string;
  company_id: string;
  lead_id: string;
  subject: string;
  body: string;
  status: string;
  created_at?: string;
  updated_at?: string;
}
/* =========================================================
   ENRICHMENT TYPES
========================================================= */

export type EnrichmentState =
  | "pending"
  | "locked"
  | "enriched"
  | "failed"
  | "dead";

export interface EnrichmentReasoning {
  strategy: string;
  llm_used?: boolean;
  decision_maker?: string | null;
  inferred_email_pattern?: string | null;
  api_verified?: boolean;
  notes?: string;
}
/* =========================================================
   DELIVERABILITY TYPES
========================================================= */

export interface Lead {
  id: string;
  brand_id: string;
  company_id: string;
  source_id: string | null;
  email: string;
  email_verified: boolean | null;
  confidence: number | null;
  bounce_count: number;
  reply_count: number;
  last_outcome_at: string | null;
  created_at: string;
}

export interface SignalSourcePerformance {
  id: string;
  source_id: string;
  brand_id: string;
  sends: number;
  replies: number;
  bounces: number;
  last_updated: string;
}

/* =========================================================
   DISCOVERY TYPES (STRUCTURED)
========================================================= */

export interface DiscoverySource {
  id: string;
  brand_id: string;
  name: string;
  type: string;
  config: unknown;
  rate_limit_per_min: number | null;
  execution_mode: string;
  schedule_cron: string | null;
  retry_count: number;
  next_attempt_at: string | null;
  last_run_at: string | null;
  is_active: boolean;
  is_running: boolean;
  last_error: string | null;
  created_at: string;
}

export interface DiscoveredCompany {
  id: string;
  brand_id: string;
  source_id: string | null;
  name: string | null;
  domain: string;

  risk: "SAFE_API" | "MODERATE_PUBLIC" | "HIGH_SCRAPE" | null;
  confidence: number | null;
  intent_score: number | null;
  requires_enrichment: boolean;

  raw_payload: unknown | null;

  processed: boolean;
  ingested: boolean;
  dead_letter: boolean;

  retry_count: number;
  next_attempt_at: string | null;
  error: string | null;

  enrichment_status: EnrichmentState;
  enrichment_attempts: number;
  last_enrichment_at: string | null;
  enrichment_source: string | null;
  enrichment_reasoning: unknown | null;
  enrichment_error: string | null;

  created_at: string;
}

import type { DiscoveryRisk } from "../discovery/types";

export interface DiscoveredContact {
  id: string;
  brand_id: string;
  discovered_company_id: string;

  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  title: string | null;
  linkedin_url: string | null;

  risk: DiscoveryRisk | null;
  confidence: number | null;
  intent_score: number | null;
  requires_enrichment: boolean;

  raw_payload: unknown | null;
  processed: boolean;
  ingested: boolean;
  retry_count: number;
  next_attempt_at: string | null;
  error: string | null;
  created_at: string;

  dead_letter: boolean;

  domain: string | null;
  source_id: string | null;

  /* NEW ENRICHMENT FIELDS */
  enrichment_status: EnrichmentState;
  enrichment_attempts: number;
  last_enrichment_at: string | null;
  enrichment_source: string | null;
  enrichment_reasoning: EnrichmentReasoning | null;
  enrichment_error: string | null;
}

/* =========================================================
   HEALTH CHECK
========================================================= */

export async function testConnection() {
  const { error } = await supabase.from("system_flags").select("key").limit(1);

  if (error) {
    logger.fatal({ error: error.message }, "Supabase connection failed");
    process.exit(1);
  }

  logger.info("Supabase connected");
}

/* =========================================================
   BRAND
========================================================= */

export async function resolveBrandByProduct(
  product: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("brand_profiles")
    .select("id")
    .eq("product", product.toLowerCase())
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

export async function getBrandProfile(
  brandId: string,
): Promise<BrandProfile | null> {
  const { data, error } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("id", brandId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.is_active) return null;

  return data as BrandProfile;
}

/* =========================================================
   COMPANY CLAIMING
========================================================= */

export async function claimCompanies(
  brandId: string,
  status: string,
  limit: number,
): Promise<Company[]> {
  return safeRpc("rpc_claim_companies", {
    p_brand_id: brandId,
    p_status: status,
    p_limit: limit,
  });
}

export async function claimOutreachDraft(
  companyId: string,
): Promise<OutreachDraft | null> {
  return safeRpc("rpc_claim_outreach_draft", {
    p_company_id: companyId,
  });
}

export async function updateCompanyStatus(
  companyId: string,
  expectedStatus: string,
  newStatus: string,
  brandId?: string,
): Promise<boolean> {
  return safeRpc("rpc_update_company_status", {
    p_company_id: companyId,
    p_expected_status: expectedStatus,
    p_new_status: newStatus,
    p_brand_id: brandId ?? null,
  });
}

export async function updateLeadStatus(leadId: string, newStatus: string) {
  await safeRpc("rpc_update_lead_status", {
    p_lead_id: leadId,
    p_new_status: newStatus,
  });
}

/* =========================================================
   RETRY + DEAD LETTER
========================================================= */

export async function scheduleRetry(leadId: string, errorMessage: string) {
  await safeRpc("schedule_retry", {
    p_lead_id: leadId,
    p_error: errorMessage,
  });
}

export async function detectStuckLeads(): Promise<number> {
  return safeRpc("detect_stuck_leads", {});
}

/* =========================================================
   DOMAIN THROTTLE
========================================================= */

export async function consumeSendQuota(
  brandId: string,
  domain: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("consume_send_quota", {
    p_brand_id: brandId,
    p_domain: domain.toLowerCase(),
  });

  if (error) {
    return false;
  }

  return data === true;
}

export async function checkSendQuota(
  brandId: string,
  domain: string,
): Promise<{
  daily: { used: number; limit: number };
  hourly: { used: number; limit: number };
} | null> {
  const { data, error } = await supabase.rpc("check_client_send_quota", {
    p_brand_id: brandId,
  });

  if (error || !data) {
    return null;
  }

  return {
    daily: { used: data.daily_remaining, limit: data.daily_remaining },
    hourly: { used: data.hourly_remaining, limit: data.hourly_remaining },
  };
}

export async function registerBounce(brandId: string, domain: string) {
  await safeRpc("register_bounce", {
    p_brand_id: brandId,
    p_domain: domain.toLowerCase(),
  });
}

/* =========================================================
   DISCOVERY RPCS
========================================================= */

export async function claimDiscoverySources(
  limit: number,
): Promise<DiscoverySource[]> {
  return safeRpc("rpc_claim_discovery_sources", {
    p_limit: limit,
  });
}

export async function releaseDiscoverySource(params: {
  source_id: string;
  success: boolean;
  error?: string | null;
  companies?: number;
  contacts?: number;
  duration_ms?: number;
}) {
  await safeRpc("rpc_release_discovery_source", {
    p_source_id: params.source_id,
    p_success: params.success,
    p_error: params.error ?? null,
    p_companies: params.companies ?? 0,
    p_contacts: params.contacts ?? 0,
    p_duration_ms: params.duration_ms ?? 0,
  });
}

export async function claimDiscoveredCompanies(
  limit: number,
): Promise<DiscoveredCompany[]> {
  return safeRpc("rpc_claim_discovered_companies", {
    p_limit: limit,
  });
}

export async function completeDiscoveredCompany(params: {
  id: string;
  success: boolean;
  error?: string | null;
  requires_enrichment?: boolean | null;
}) {
  await safeRpc("rpc_complete_discovered_company", {
    p_id: params.id,
    p_success: params.success,
    p_error: params.error ?? null,
    p_requires_enrichment: params.requires_enrichment ?? null,
  });
}

export async function claimDiscoveredContacts(
  limit: number,
): Promise<DiscoveredContact[]> {
  return safeRpc("rpc_claim_discovered_contacts", {
    p_limit: limit,
  });
}

export async function completeDiscoveredContact(params: {
  id: string;
  success: boolean;
  error?: string | null;
  requires_enrichment?: boolean | null;
}) {
  await safeRpc("rpc_complete_discovered_contact", {
    p_id: params.id,
    p_success: params.success,
    p_error: params.error ?? null,
    p_requires_enrichment: params.requires_enrichment ?? null,
  });
}

/* =========================================================
   ENRICHMENT RPCs
========================================================= */

export async function claimContactsForEnrichment(
  brandId: string,
  limit: number,
): Promise<DiscoveredContact[]> {
  return safeRpc("claim_contacts_for_enrichment", {
    p_brand_id: brandId,
    p_limit: limit,
  });
}

export async function updateContactEnrichment(params: {
  id: string;
  confidence: number;
  status: EnrichmentState;
  email?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
  intent_score?: number | null;
  error?: string | null;
}) {
  await safeRpc("update_contact_enrichment", {
    p_contact_id: params.id,
    p_confidence: params.confidence,
    p_email: params.email ?? null,
    p_title: params.title ?? null,
    p_linkedin_url: params.linkedin_url ?? null,
    p_intent_score: params.intent_score ?? null,
    p_status: params.status,
    p_error: params.error ?? null,
  });
}
export async function claimCompaniesForEnrichment(
  brandId: string,
  batchSize: number,
): Promise<DiscoveredCompany[]> {
  return safeRpc("claim_companies_for_enrichment", {
    p_brand_id: brandId,
    p_batch_size: batchSize,
  });
}

export function validateEnrichmentUpdate(params: {
  confidence: number;
  status: EnrichmentState;
}) {
  if (params.confidence < 0 || params.confidence > 1) {
    throw new Error("Confidence must be between 0 and 1");
  }

  if (params.status === "enriched" && params.confidence < 0.7) {
    throw new Error("Cannot mark enriched with low confidence");
  }
}

/* =========================================================
   DELIVERABILITY RPCs
========================================================= */

export async function recalibrateLeadConfidence(
  leadId: string,
  newConfidence: number,
) {
  await safeRpc("rpc_recalibrate_lead_confidence", {
    p_lead_id: leadId,
    p_new_confidence: newConfidence,
  });
}

export async function updateBrandDeliverability(params: {
  brandId: string;
  score: number;
  autoPause: boolean;
}) {
  await safeRpc("rpc_update_brand_deliverability", {
    p_brand_id: params.brandId,
    p_score: params.score,
    p_auto_pause: params.autoPause,
  });
}
export async function updateSignalSourcePerformance(params: {
  brandId: string;
  sourceId: string;
  sendDelta?: number;
  replyDelta?: number;
  bounceDelta?: number;
}) {
  const { error } = await supabase.from("signal_source_performance").upsert({
    source_id: params.sourceId,
    brand_id: params.brandId,
    sends: params.sendDelta ?? 0,
    replies: params.replyDelta ?? 0,
    bounces: params.bounceDelta ?? 0,
    last_updated: new Date().toISOString(),
  }, {
    onConflict: 'source_id, brand_id',
  });

  if (error) {
    logger.error(
      { error: error.message, params },
      "Failed to update signal source performance"
    );
  }
}
export function assertBrandSendAllowed(brand: BrandProfile) {
  if (brand.auto_paused) {
    throw new Error(
      `Brand ${brand.brand_name} is auto-paused due to deliverability risk`,
    );
  }
}

/* =========================================================
   CLIENT LLM SETTINGS
/* ========================================================= */

export async function getClientLLMSettings(
  clientId: string,
): Promise<ClientSettings | null> {
  const { data, error } = await supabase
    .from("client_settings")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    logger.warn({ error: error.message }, "Failed to get client settings");
    return null;
  }

  return data as ClientSettings;
}

export async function updateClientLLMSettings(
  clientId: string,
  settings: Partial<ClientSettings>,
): Promise<void> {
  const { error } = await supabase
    .from("client_settings")
    .upsert({
      ...settings,
      client_id: clientId,
      updated_at: new Date().toISOString(),
    })
    .select();

  if (error) {
    throw new Error(`Failed to update client settings: ${error.message}`);
  }
}

export async function getRunnableBrands(): Promise<BrandProfile[]> {
  const { data, error } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("is_active", true)
    .eq("is_paused", false)
    .eq("outbound_enabled", true);

  if (error) throw error;

  return (data ?? []) as BrandProfile[];
}

export async function getActiveApiBrands(): Promise<BrandProfile[]> {
  const { data, error } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("is_active", true)
    .eq("transport_mode", "api");

  if (error) throw error;
  return (data ?? []) as BrandProfile[];
}

/* =========================================================
   IMAP BRAND FETCH (RPC SAFE)
========================================================= */

export interface BrandIMAPConfig {
  id: string;
  product: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_email: string;
  imap_password: string;
}

export async function getActiveImapBrands(): Promise<BrandIMAPConfig[]> {
  return safeRpc("rpc_get_imap_brands", {});
}

/* =========================================================
   DISTRIBUTED API QUOTA
========================================================= */

export async function consumeApiQuota(
  sourceId: string,
  limit: number,
): Promise<boolean> {
  return safeRpc("rpc_consume_api_quota", {
    p_source_id: sourceId,
    p_limit: limit,
  });
}

/* =========================================================
   DISCOVERY METRICS
========================================================= */

export async function recordDiscoveryMetric(params: {
  source_id: string;
  companies: number;
  contacts: number;
  duration_ms: number;
  success: boolean;
  error?: string | null;
}) {
  const { error } = await supabase.from("discovery_metrics").insert({
    source_id: params.source_id,
    companies_discovered: params.companies,
    contacts_discovered: params.contacts,
    duration_ms: params.duration_ms,
    success: params.success,
    error: params.error ?? null,
  });

  if (error) {
    throw new Error(`Metric insert failed: ${error.message}`);
  }
}

/* =========================================================
   LEAD INGESTION
========================================================= */

export async function ingestLead(params: {
  brand_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email: string;
  title?: string;
  company_name?: string;
  domain?: string;
  linkedin_url?: string;
  source: string;
  source_id?: string;
  raw_payload?: unknown;
}) {
  return safeRpc("rpc_ingest_lead", {
    p_brand_id: params.brand_id,
    p_first_name: params.first_name ?? null,
    p_last_name: params.last_name ?? null,
    p_full_name: params.full_name ?? null,
    p_email: params.email.toLowerCase(),
    p_title: params.title ?? null,
    p_company_name: params.company_name ?? null,
    p_domain: params.domain?.toLowerCase() ?? null,
    p_linkedin_url: params.linkedin_url ?? null,
    p_source: params.source,
    p_source_id: params.source_id ?? null,
    p_raw_payload: params.raw_payload ?? null,
  });
}

/* =========================================================
   OUTBOUND MESSAGE
========================================================= */

export async function markLeadContacted(
  leadId: string,
  subject: string,
  body: string,
  messageId: string,
): Promise<boolean> {
  return safeRpc("rpc_mark_lead_contacted", {
    p_lead_id: leadId,
    p_subject: subject,
    p_body: body,
    p_message_id: messageId,
  });
}

export async function insertReply(
  companyId: string,
  leadId: string,
  messageId: string,
  body: string,
  subject?: string,
): Promise<boolean> {
  return safeRpc("rpc_insert_reply", {
    p_company_id: companyId,
    p_lead_id: leadId,
    p_message_id: messageId,
    p_body: body,
    p_subject: subject ?? null,
  });
}

export async function scoreLead(leadId: string) {
  await safeRpc("rpc_score_lead", {
    p_lead_id: leadId,
  });
}

export async function closeCompany(params: {
  company_id: string;
  deal_value: number;
  currency: string;
  contract_length: number;
  payment_model: string;
  gross_margin: number;
}) {
  await safeRpc("rpc_close_company", {
    p_company_id: params.company_id,
    p_deal_value: params.deal_value,
    p_currency: params.currency,
    p_contract_length: params.contract_length,
    p_payment_model: params.payment_model,
    p_gross_margin: params.gross_margin,
  });
}

export async function registerFailure(
  entityType: "company" | "lead",
  entityId: string,
  errorMessage: string,
): Promise<boolean> {
  return safeRpc("rpc_register_failure", {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_error: errorMessage,
  });
}

export async function isBlacklisted(
  email?: string,
  domain?: string,
): Promise<boolean> {
  return safeRpc("rpc_is_blacklisted", {
    p_email: email?.toLowerCase() ?? null,
    p_domain: domain?.toLowerCase() ?? null,
  });
}

export async function updateSignalPerformance(companyId: string) {
  await safeRpc("rpc_update_signal_performance_for_company", {
    p_company_id: companyId,
  });
}

export async function claimInboundEvent(params: {
  eventId: string;
  brandId: string;
  eventType: string;
}): Promise<boolean> {
  const { data, error } = await supabase
    .from("inbound_events")
    .insert({
      event_id: params.eventId,
      event_type: params.eventType,
      brand_id: params.brandId,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // Unique violation = already processed
    if (error.code === "23505") {
      return false;
    }
    throw error;
  }

  return !!data;
}
