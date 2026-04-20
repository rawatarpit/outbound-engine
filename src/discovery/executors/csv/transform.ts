import type {
  DiscoveryCompany,
  DiscoveryContact,
  DiscoveryRisk
} from "../../types"

import {
  normalizeDomain,
  normalizeEmail
} from "../../normalizer"

const CSV_RISK: DiscoveryRisk =
  "safe_api" as DiscoveryRisk

export function transformCsvRow(
  row: Record<string, string>,
  columnMap: {
    name?: string
    domain: string
    email?: string
  },
  sourceId: string
): {
  company: DiscoveryCompany | null
  contact: DiscoveryContact | null
} {

  const domainRaw = row[columnMap.domain]
  const domain = normalizeDomain(domainRaw)

  if (!domain) {
    return { company: null, contact: null }
  }

  const company: DiscoveryCompany = {
    name: columnMap.name
      ? row[columnMap.name] ?? domain
      : domain,
    domain,
    source: sourceId,
    risk: CSV_RISK,
    confidence: 0.9,
    intent_score: 0.5,
    requires_enrichment: false,
    raw: row
  }

  let contact: DiscoveryContact | null = null

  if (columnMap.email) {
    const emailRaw = row[columnMap.email]
    const email = normalizeEmail(emailRaw)

    if (email) {
      contact = {
        email,
        domain,
        source: sourceId,
        risk: CSV_RISK,
        confidence: 0.9,
        intent_score: 0.5,
        requires_enrichment: false,
        raw: row
      }
    }
  }

  return { company, contact }
}