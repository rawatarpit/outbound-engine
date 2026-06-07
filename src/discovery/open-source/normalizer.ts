import type { DiscoveryCompany } from "../types"

export interface RawDiscoveryResult {
  company_name: string
  domain: string
  description?: string
  industry?: string
  tech_stack?: string[]
  employees?: string
  funding?: string
  revenue?: string
  key_people?: { name: string; title: string }[]
  emails?: string[]
  social_links?: string[]
  source_url?: string
  signal_type?: string
  relevance_score?: number
  urgency_score?: number
}

export function normalizeToDiscoveryCompany(
  raw: RawDiscoveryResult,
  signal: string,
  intentId: string,
): DiscoveryCompany | null {
  if (!raw.domain || !raw.company_name) return null

  return {
    source: "open_source_orchestrator",
    source_url: raw.source_url || `https://${raw.domain}`,
    risk: "SAFE_API" as any,
    domain: raw.domain,
    name: raw.company_name,
    summary: raw.description?.substring(0, 500) || raw.company_name,
    signal_type: signal,
    relevance_score: raw.relevance_score || 65,
    urgency_score: raw.urgency_score || 35,
    fit_reason: `Enriched: ${raw.industry || "unknown industry"}`,
    raw: {
      intent_id: intentId,
      signal,
      industry: raw.industry || null,
      tech_stack: raw.tech_stack || [],
      employees: raw.employees || null,
      funding: raw.funding || null,
      revenue: raw.revenue || null,
      key_people: raw.key_people || [],
      emails: raw.emails || [],
      social_links: raw.social_links || [],
    },
  } as unknown as DiscoveryCompany
}
