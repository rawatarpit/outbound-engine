import pino from "pino"
import { executeScraplingSearch } from "../../../core/utils/scrapling"
import { DiscoveryRisk } from "../../types"
import type { DiscoveryResult } from "../../types"

const logger = pino({ level: "debug" })

export interface LinkedInAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
}

export async function linkedinAdapter(
  config: LinkedInAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 20 } = config

  try {
    const linkedinQuery = `site:linkedin.com/company ${query}`
    const results = await executeScraplingSearch(linkedinQuery, "google", max_results)

    const companies = []

    for (const r of results) {
      const title = r.title || ""
      const body = r.body || ""
      const url = r.url || ""

      if (!url.includes("linkedin.com/company")) continue

      const nameMatch = title.match(/^(.+?)\s*(?:-\s*LinkedIn|\||on\s+LinkedIn)/i)
      const companyName = nameMatch?.[1]?.trim() || r.company || title.split(" - ")[0]?.trim() || "Unknown"

      if (companyName === "Unknown" || companyName.length < 2) continue

      const domain = `${companyName.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`
      const resolvedDomain = await resolveDomainSafe(companyName)

      companies.push({
        source: "linkedin",
        source_url: url,
        domain: resolvedDomain || domain,
        name: companyName,
        title: companyName,
        summary: body.substring(0, 500),
        risk: DiscoveryRisk.MODERATE_PUBLIC,
        raw: { query, intent_id, signal, source: "linkedin_search" },
      })
    }

    logger.info({ query, count: companies.length }, "LinkedIn adapter completed")
    return { companies: companies as any, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "LinkedIn adapter failed")
    return { companies: [], contacts: [] }
  }
}

async function resolveDomainSafe(companyName: string): Promise<string | null> {
  try {
    const { domainResolver } = await import("../../utils/domain-resolver")
    return await domainResolver.resolve(companyName)
  } catch {
    return null
  }
}
