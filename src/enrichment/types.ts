/* =========================================================
   ENRICHMENT TARGET TYPE
========================================================= */

export type EnrichmentTargetType = "company" | "contact";

/* =========================================================
   ENRICHMENT STRATEGY TYPES
========================================================= */

export enum EnrichmentStrategyType {
  API_ENRICHMENT = "API_ENRICHMENT",
  EMAIL_PATTERN = "EMAIL_PATTERN",
  COMPANY_RESEARCH = "COMPANY_RESEARCH",
  LLM_RESEARCH = "LLM_RESEARCH",
}

/* =========================================================
   ENRICHMENT STATUS
========================================================= */

export enum EnrichmentStatus {
  SUCCESS = "SUCCESS",
  PARTIAL = "PARTIAL",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
}

/* =========================================================
   CLAIMED COMPANY (INPUT FROM DB)
========================================================= */

export interface ClaimedCompany {
  id: string;
  brand_id: string;

  name?: string | null;
  website?: string | null;
  domain?: string | null;

  confidence?: number | null;
  enrichment_attempts?: number | null;

  raw_payload?: unknown;
}

/* =========================================================
   CLAIMED CONTACT (INPUT FROM DB)
========================================================= */

export interface ClaimedContact {
  id: string;
  brand_id: string;

  discovered_company_id: string;

  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;

  email?: string | null;
  title?: string | null;
  linkedin_url?: string | null;

  domain: string;

  confidence?: number | null;
  enrichment_attempts?: number | null;

  raw_payload?: unknown;
}

/* =========================================================
   UNIFIED ENRICHMENT ENTITY
========================================================= */

export type EnrichmentEntity =
  | { type: "company"; entity: ClaimedCompany }
  | { type: "contact"; entity: ClaimedContact };

/* =========================================================
   ENRICHMENT CONTEXT
========================================================= */

export interface EnrichmentContext {
  type: EnrichmentTargetType;

  entity: ClaimedCompany | ClaimedContact;

  /**
   * If confidence >= threshold → stop pipeline
   */
  targetConfidence: number;

  /**
   * Max enrichment attempts allowed
   */
  maxAttempts: number;

  /**
   * Whether brand has API quota available
   */
  apiQuotaAvailable?: boolean;
}

/* =========================================================
   ENRICHMENT PLAN
========================================================= */

export interface EnrichmentPlan {
  strategies: EnrichmentStrategyType[];

  shouldProceed: boolean;
  skipReason?: string;
}

/* =========================================================
   ENRICHMENT DATA OUTPUT
========================================================= */

export interface EnrichedData {
  /* ---------- CONTACT FIELDS ---------- */
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  email_verified?: boolean;
  title?: string;
  linkedin_url?: string;

  /* ---------- COMPANY FIELDS ---------- */
  company_name?: string;
  website?: string;
  domain?: string;

  /**
   * Confidence score (0–1)
   */
  confidence: number;

  /**
   * Buying / hiring intent (0–1)
   */
  intent_score?: number;

  strategy: EnrichmentStrategyType;

  raw?: unknown;
}

/* =========================================================
   STRATEGY EXECUTION RESULT
========================================================= */

export interface EnrichmentResult {
  status: EnrichmentStatus;
  data?: EnrichedData;
  error?: string;
}

/* =========================================================
   STRATEGY EXECUTOR CONTRACT
========================================================= */

export interface EnrichmentStrategyExecutor {
  execute(context: EnrichmentContext): Promise<EnrichmentResult>;
}

/* =========================================================
   FINAL PIPELINE OUTCOME
========================================================= */

export interface FinalEnrichmentOutcome {
  type: EnrichmentTargetType;
  entityId: string;

  status: EnrichmentStatus;
  finalConfidence: number;

  enrichedData?: EnrichedData;

  strategiesAttempted: EnrichmentStrategyType[];
}
