import pino from "pino"
import { executeScraplingSearch } from "../../../core/utils/scrapling"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "debug" })

const FREELANCE_PLATFORMS = [
  "upwork.com",
  "fiverr.com",
  "freelancer.com",
  "toptal.com",
  "peopleperhour.com",
  "guru.com",
]

export interface FreelanceAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
}

function siteQuery(query: string): string {
  const siteClause = FREELANCE_PLATFORMS.map(s => `site:${s}`).join(" OR ")
  return `(${siteClause}) ${query}`
}

export async function freelanceAdapter(
  config: FreelanceAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 10 } = config

  try {
    const results = await executeScraplingSearch(siteQuery(query), "google", max_results)

    const companies: DiscoveryCompany[] = results.map((r) => ({
      source: "freelance",
      source_url: r.url || "",
      risk: DiscoveryRisk.MODERATE_PUBLIC,
      domain: (() => {
        if (r.url) {
          try { return new URL(r.url).hostname.replace("www.", "") } catch {}
        }
        return "unknown.com"
      })(),
      name: r.title || "Unknown",
      title: r.title || "",
      summary: r.body || r.title || "",
      signal_type: signal,
      relevance_score: 60,
      urgency_score: 40,
      fit_reason: `Freelance platform listing for: ${query}`,
      raw: { query, intent_id, signal, platform: FREELANCE_PLATFORMS },
    }))

    logger.info({ query, count: companies.length }, "Freelance adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Freelance adapter failed")
    return { companies: [], contacts: [] }
  }
}
