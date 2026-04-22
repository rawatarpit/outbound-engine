import type {
  DiscoveryCompany,
  DiscoveryContact,
  DiscoveryRisk
} from "../../types"

import { normalizeDomain } from "../../normalizer"

/* =========================================================
   RISK CLASSIFICATION
========================================================= */

const IH_RISK: DiscoveryRisk =
  "MODERATE_PUBLIC" as DiscoveryRisk

/* =========================================================
   RAW TYPES (Minimal Public Profile)
========================================================= */

interface IndieProfile {
  username?: string
  name?: string
  website?: string
  twitter?: string
  company?: string
}

/* =========================================================
   TRANSFORM FUNCTION
========================================================= */

export function transformIndieProfile(
  profile: IndieProfile,
  sourceId: string
): {
  company: DiscoveryCompany | null
  contact: DiscoveryContact | null
} {

  const domain = normalizeDomain(profile.website ?? null)

  if (!domain) {
    return { company: null, contact: null }
  }

  const company: DiscoveryCompany = {
    name: profile.company ?? profile.username ?? domain,
    domain,
    source: sourceId,
    risk: IH_RISK,
    confidence: 0.6,
    intent_score: 0.3,
    requires_enrichment: true,
    raw: profile
  }

  const contact: DiscoveryContact = {
    domain,
    full_name: profile.name ?? null,
    linkedin_url: null,
    source: sourceId,
    risk: IH_RISK,
    confidence: 0.5,
    intent_score: 0.2,
    requires_enrichment: true,
    raw: profile
  }

  return { company, contact }
}