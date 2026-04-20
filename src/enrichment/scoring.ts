import {
  ClaimedContact,
  ClaimedCompany,
  EnrichedData,
  EnrichmentTargetType
} from "./types"

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

/* =========================================================
   MAIN CONFIDENCE ROUTER
========================================================= */

export function computeConfidence(
  type: EnrichmentTargetType,
  entity: ClaimedContact | ClaimedCompany,
  enriched: EnrichedData
): number {

  if (type === "contact") {
    return computeContactConfidence(
      entity as ClaimedContact,
      enriched
    )
  }

  if (type === "company") {
    return computeCompanyConfidence(
      entity as ClaimedCompany,
      enriched
    )
  }

  return 0
}

/* =========================================================
   CONTACT CONFIDENCE (DETERMINISTIC SIGNAL BASED)
========================================================= */

function computeContactConfidence(
  contact: ClaimedContact,
  enriched: EnrichedData
): number {

  let confidence = 0

  // Core identity signals
  if (enriched.email) confidence += 0.4
  if (enriched.title) confidence += 0.2
  if (enriched.linkedin_url) confidence += 0.15

  // Intent signal
  if (enriched.intent_score && enriched.intent_score > 0.5) {
    confidence += 0.15
  }

  // Strategy reliability weighting
  if (enriched.strategy === "API_ENRICHMENT") {
    confidence += 0.1
  }

  if (enriched.strategy === "LLM_RESEARCH") {
    confidence -= 0.05
  }

  return clamp(Number(confidence.toFixed(3)))
}

/* =========================================================
   COMPANY CONFIDENCE (SIGNAL-BASED, NON-ACCUMULATIVE)
========================================================= */

function computeCompanyConfidence(
  company: ClaimedCompany,
  enriched: EnrichedData
): number {

  let confidence = 0

  // Core verification signals
  if (enriched.website) confidence += 0.35
  if (enriched.domain) confidence += 0.25
  if (enriched.company_name) confidence += 0.15

  // Buying intent signal
  if (enriched.intent_score && enriched.intent_score > 0.5) {
    confidence += 0.15
  }

  // Strong API-based enrichment bonus
  if (enriched.strategy === "API_ENRICHMENT") {
    confidence += 0.1
  }

  // Slight uncertainty penalty for LLM-only research
  if (enriched.strategy === "LLM_RESEARCH") {
    confidence -= 0.05
  }

  return clamp(Number(confidence.toFixed(3)))
}