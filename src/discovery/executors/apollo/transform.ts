import type {
  DiscoveryCompany,
  DiscoveryContact,
  DiscoveryRisk
} from "../../types"
import { normalizeDomain, normalizeEmail } from "../../normalizer"

/* =========================================================
   RISK CLASSIFICATION
========================================================= */

const APOLLO_RISK: DiscoveryRisk =
  "SAFE_API" as DiscoveryRisk

/* =========================================================
   RAW APOLLO TYPES (minimal subset)
========================================================= */

interface ApolloPerson {
  first_name?: string
  last_name?: string
  email?: string
  title?: string
  organization?: {
    name?: string
    website_url?: string
  }
}

interface ApolloResponse {
  people?: ApolloPerson[]
}

/* =========================================================
   TRANSFORM FUNCTION
========================================================= */

export function transformApolloResponse(
  response: ApolloResponse,
  sourceId: string
): {
  companies: DiscoveryCompany[]
  contacts: DiscoveryContact[]
} {

  const companies: DiscoveryCompany[] = []
  const contacts: DiscoveryContact[] = []

  for (const person of response.people ?? []) {

    const domainRaw = person.organization?.website_url
    if (!domainRaw) continue

    const domain = normalizeDomain(domainRaw)
    if (!domain) continue

    /* -------- Company -------- */

    companies.push({
      name: person.organization?.name ?? domain,
      domain,
      source: sourceId,
      risk: APOLLO_RISK,
      confidence: 0.9,
      intent_score: 0.6,
      requires_enrichment: false,
      raw: person
    })

    /* -------- Contact -------- */

    const email = person.email
      ? normalizeEmail(person.email)
      : null

    if (!email) continue

    contacts.push({
      domain,
      email,
      first_name: person.first_name ?? null,
      last_name: person.last_name ?? null,
      full_name:
        person.first_name && person.last_name
          ? `${person.first_name} ${person.last_name}`
          : null,
      title: person.title ?? null,
      source: sourceId,
      risk: APOLLO_RISK,
      confidence: 0.9,
      intent_score: 0.6,
      requires_enrichment: false,
      raw: person
    })
  }

  return { companies, contacts }
}