import type {
  DiscoveryCompany,
  DiscoveryContact,
  DiscoveryRisk
} from "../../types"
import { normalizeDomain, normalizeEmail } from "../../normalizer"

/* =========================================================
   RAW TYPES (minimal Hunter API subset)
========================================================= */

interface HunterEmail {
  value: string
  first_name?: string
  last_name?: string
  position?: string
  confidence?: number
}

interface HunterResponse {
  data?: {
    domain?: string
    company?: string
    emails?: HunterEmail[]
  }
}

/* =========================================================
   RISK CLASSIFICATION
========================================================= */

const HUNTER_RISK: DiscoveryRisk =
  "safe_api" as DiscoveryRisk

/* =========================================================
   TRANSFORM FUNCTION
========================================================= */

export function transformHunterResponse(
  response: HunterResponse,
  sourceId: string,
  brandId: string
): {
  companies: DiscoveryCompany[]
  contacts: DiscoveryContact[]
} {

  const companies: DiscoveryCompany[] = []
  const contacts: DiscoveryContact[] = []

  const domainRaw = response.data?.domain
  const companyName = response.data?.company

  if (!domainRaw) {
    return { companies, contacts }
  }

  const domain = normalizeDomain(domainRaw)
  if (!domain) {
    return { companies, contacts }
  }

  /* -------- Company -------- */

  companies.push({
    name: companyName ?? domain,
    domain,
    source: sourceId,
    risk: HUNTER_RISK,
    confidence: 0.9,
    intent_score: 0.5,
    requires_enrichment: false,
    raw: response
  })

  /* -------- Contacts -------- */

  for (const emailObj of response.data?.emails ?? []) {

    const email = normalizeEmail(emailObj.value)
    if (!email) continue

    contacts.push({
      domain,
      email,
      first_name: emailObj.first_name ?? null,
      last_name: emailObj.last_name ?? null,
      full_name:
        emailObj.first_name && emailObj.last_name
          ? `${emailObj.first_name} ${emailObj.last_name}`
          : null,
      title: emailObj.position ?? null,

      source: sourceId,

      risk: HUNTER_RISK,

      confidence:
        emailObj.confidence
          ? Math.min(emailObj.confidence / 100, 1)
          : 0.6,

      intent_score: 0.5,

      requires_enrichment: false,

      raw: emailObj
    })
  }

  return { companies, contacts }
}