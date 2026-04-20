/**
 * ===============================
 * Discovery Risk Classification
 * ===============================
 *
 * SAFE_API:
 *   - Trusted APIs with validated data (Hunter, Apollo, Clearbit)
 *
 * MODERATE_PUBLIC:
 *   - Public platforms with partial structure (GitHub, ProductHunt)
 *
 * HIGH_SCRAPE:
 *   - Crawlers, job boards, website scraping, public LinkedIn
 *   - Must never auto-ingest without enrichment
 */
export enum DiscoveryRisk {
  SAFE_API = "SAFE_API",
  MODERATE_PUBLIC = "MODERATE_PUBLIC",
  HIGH_SCRAPE = "HIGH_SCRAPE"
}

/**
 * ===============================
 * Shared Attribution + Trust Metadata
 * ===============================
 *
 * Every discovered entity MUST carry:
 * - Provider attribution
 * - Risk classification
 * - Confidence metadata
 * - Raw payload reference
 *
 * No executor-specific fields should leak downstream.
 */
export interface DiscoveryAttribution {
  /**
   * Executor/provider identifier
   * Must match registry key
   */
  source: string

  /**
   * Page URL or API endpoint used
   */
  source_url?: string

  /**
   * Risk level classification
   */
  risk: DiscoveryRisk

  /**
   * Confidence score (0–1)
   * Reflects quality of data from provider
   */
  confidence?: number

  /**
   * Intent score (0–1)
   * Optional buying / hiring / growth signal
   */
  intent_score?: number

  /**
   * If true → processor MUST gate ingestion
   * Used for HIGH_SCRAPE or uncertain data
   */
  requires_enrichment?: boolean

  /**
   * Original raw provider payload
   * Stored only for traceability + debugging
   */
  raw?: unknown
}

/**
 * ===============================
 * Discovered Company
 * ===============================
 *
 * Domain is mandatory.
 * Name is optional (may be inferred later).
 */
export interface DiscoveryCompany extends DiscoveryAttribution {
  name?: string
  domain: string
}

/**
 * ===============================
 * Discovered Contact
 * ===============================
 *
 * Email is optional to support scraping-first pipelines.
 * Enrichment layer must safely resolve missing emails.
 */
export interface DiscoveryContact extends DiscoveryAttribution {
  first_name?: string
  last_name?: string
  full_name?: string

  /**
   * Optional during discovery
   * Required before outreach
   */
  email?: string

  /**
   * Company domain (mandatory)
   */
  domain: string

  title?: string
  linkedin_url?: string
}

/**
 * ===============================
 * Executor Run Metadata
 * ===============================
 *
 * Used for:
 * - Health tracking
 * - Rate-limit detection
 * - Provider scoring
 * - Auto-disable logic
 */
export interface DiscoveryMeta {
  executor: string
  risk: DiscoveryRisk

  total_fetched: number
  total_companies?: number
  total_contacts?: number

  /**
   * Whether rate limiting occurred
   */
  rate_limited?: boolean

  /**
   * Health indicator from executor
   */
  source_health?: "healthy" | "degraded" | "blocked"

  /**
   * Optional execution duration in ms
   */
  duration_ms?: number
}

/**
 * ===============================
 * Standardized Discovery Result
 * ===============================
 *
 * Every executor MUST return this shape.
 * No executor-specific variations allowed.
 */
export interface DiscoveryResult {
  companies?: DiscoveryCompany[]
  contacts?: DiscoveryContact[]
  meta?: DiscoveryMeta
}

/**
 * ===============================
 * Executor Contract
 * ===============================
 *
 * Every discovery provider must implement this interface.
 * Engine must ONLY call execute().
 */
export interface DiscoveryExecutor {
  execute(config: unknown): Promise<DiscoveryResult>
}
