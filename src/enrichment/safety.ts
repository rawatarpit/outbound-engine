import {
  EnrichmentContext,
  ClaimedContact,
  ClaimedCompany
} from "./types"

export async function enforceSafety(
  context: EnrichmentContext
) {
  const { type, entity, maxAttempts } = context

  const attempts = entity.enrichment_attempts ?? 0

  /* -----------------------------------------
     MAX ATTEMPTS GUARD
  ------------------------------------------ */

  if (attempts >= maxAttempts) {
    return {
      allowed: false,
      reason: "Max enrichment attempts reached"
    }
  }

  /* -----------------------------------------
     TYPE-SPECIFIC SAFETY
  ------------------------------------------ */

  if (type === "contact") {
    const contact = entity as ClaimedContact

    if (!contact.domain) {
      return {
        allowed: false,
        reason: "Missing contact domain"
      }
    }
  }

  if (type === "company") {
    const company = entity as ClaimedCompany

    if (!company.domain && !company.website) {
      return {
        allowed: false,
        reason: "Missing company domain/website"
      }
    }
  }

  return { allowed: true }
}