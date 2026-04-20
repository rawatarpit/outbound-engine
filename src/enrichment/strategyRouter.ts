import {
  EnrichmentContext,
  EnrichmentPlan,
  EnrichmentStrategyType,
  ClaimedContact,
  ClaimedCompany
} from "./types"

/* =========================================================
   MAIN STRATEGY ROUTER
========================================================= */

export async function buildEnrichmentPlan(
  context: EnrichmentContext
): Promise<EnrichmentPlan> {

  const { type, entity, targetConfidence } = context

  const currentConfidence = entity.confidence ?? 0

  if (currentConfidence >= targetConfidence) {
    return {
      strategies: [],
      shouldProceed: false,
      skipReason: "Already high confidence"
    }
  }

  if (type === "contact") {
    return buildContactPlan(entity as ClaimedContact)
  }

  if (type === "company") {
    return buildCompanyPlan(entity as ClaimedCompany)
  }

  return {
    strategies: [],
    shouldProceed: false,
    skipReason: "Unknown enrichment type"
  }
}

/* =========================================================
   CONTACT ENRICHMENT PLAN
========================================================= */

function buildContactPlan(
  contact: ClaimedContact
): EnrichmentPlan {

  const strategies: EnrichmentStrategyType[] = []

  // If missing email but domain exists → try API + pattern
  if (!contact.email && contact.domain) {
    strategies.push(EnrichmentStrategyType.API_ENRICHMENT)
    strategies.push(EnrichmentStrategyType.EMAIL_PATTERN)
  }

  // Missing job title → company research
  if (!contact.title) {
    strategies.push(EnrichmentStrategyType.COMPANY_RESEARCH)
  }

  // Always allow LLM research as fallback
  strategies.push(EnrichmentStrategyType.LLM_RESEARCH)

  return {
    strategies,
    shouldProceed: strategies.length > 0
  }
}

/* =========================================================
   COMPANY ENRICHMENT PLAN
========================================================= */

function buildCompanyPlan(
  company: ClaimedCompany
): EnrichmentPlan {

  const strategies: EnrichmentStrategyType[] = []

  // If website or domain missing → try API enrichment
  if (!company.website && company.domain) {
    strategies.push(EnrichmentStrategyType.API_ENRICHMENT)
  }

  // If name missing → company research
  if (!company.name) {
    strategies.push(EnrichmentStrategyType.COMPANY_RESEARCH)
  }

  // LLM fallback for deep company understanding
  strategies.push(EnrichmentStrategyType.LLM_RESEARCH)

  return {
    strategies,
    shouldProceed: strategies.length > 0
  }
}