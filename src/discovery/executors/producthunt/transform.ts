import type {
  DiscoveryCompany,
  DiscoveryContact,
  DiscoveryRisk
} from "../../types"
import { normalizeDomain } from "../../normalizer"

/* =========================================================
   RISK CLASSIFICATION
========================================================= */

const PH_RISK: DiscoveryRisk =
  "medium" as DiscoveryRisk

/* =========================================================
   HELPERS
========================================================= */

function extractDomain(url?: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return null
  }
}

/* =========================================================
   TRANSFORM FUNCTION
========================================================= */

export function transformProductHuntNode(
  node: any,
  sourceId: string
): {
  company: DiscoveryCompany | null
  contacts: DiscoveryContact[]
} {

  if (!node?.website) {
    return { company: null, contacts: [] }
  }

  const domainRaw = extractDomain(node.website)
  const domain = normalizeDomain(domainRaw)

  if (!domain || domain === "producthunt.com") {
    return { company: null, contacts: [] }
  }

  const company: DiscoveryCompany = {
    name: node.name,
    domain,
    source: sourceId,
    risk: PH_RISK,
    confidence: 0.75,
    intent_score: node.votesCount
      ? Math.min(node.votesCount / 5000, 1)
      : 0.2,
    requires_enrichment: true,
    raw: node
  }

  const contacts: DiscoveryContact[] = []

  if (Array.isArray(node.makers)) {
    for (const maker of node.makers) {
      contacts.push({
        domain,
        full_name: maker.name ?? null,
        linkedin_url: null,
        source: sourceId,
        risk: PH_RISK,
        confidence: 0.6,
        intent_score: 0.3,
        requires_enrichment: true,
        raw: maker
      })
    }
  }

  return { company, contacts }
}