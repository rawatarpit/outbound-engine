import {
  EnrichmentContext,
  ClaimedContact,
  ClaimedCompany
} from "./types"
import { isJobBoardOrRecruiter } from "../discovery/core/job-board-filter"
import { isEnterpriseDomain, isEnterpriseDescription, isMediaDomain } from "../discovery/core/enterprise-filter"

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

    const domainToCheck = company.domain || company.website || ""
    const nameToCheck = company.name || ""
    if (isJobBoardOrRecruiter(domainToCheck, nameToCheck)) {
      return {
        allowed: false,
        reason: "Job board or recruiting agency detected"
      }
    }

    if (isEnterpriseDomain(domainToCheck)) {
      return {
        allowed: false,
        reason: "Enterprise domain detected"
      }
    }

    if (isMediaDomain(domainToCheck)) {
      return {
        allowed: false,
        reason: "Media/social domain detected"
      }
    }

    const rawPayload = company.raw_payload as any
    const description = rawPayload?.description || ""
    const companySize = rawPayload?.company_size || ""
    if (isEnterpriseDescription(description) || companySize === "enterprise") {
      return {
        allowed: false,
        reason: "Enterprise company detected"
      }
    }
  }

  return { allowed: true }
}