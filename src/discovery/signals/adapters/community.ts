import pino from "pino"
import { executeScraplingSearch } from "../../../core/utils/scrapling"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "debug" })

const FORUM_DOMAINS = [
  "indiehackers.com",
  "quora.com",
  "producthunt.com",
  "stackoverflow.com",
  "warpforum.com",
  "growthhackers.com",
]

export interface CommunityAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
}

function siteQuery(query: string): string {
  const siteClause = FORUM_DOMAINS.map(s => `site:${s}`).join(" OR ")
  return `(${siteClause}) ${query}`
}

export async function communityAdapter(
  config: CommunityAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 10 } = config

  try {
    const results = await executeScraplingSearch(siteQuery(query), "google", max_results)

    const companies: DiscoveryCompany[] = results.map((r) => ({
      source: "community",
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
      relevance_score: 55,
      urgency_score: 35,
      fit_reason: `Community forum match for: ${query}`,
      raw: { query, intent_id, signal, platform: FORUM_DOMAINS },
    }))

    logger.info({ query, count: companies.length }, "Community adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Community adapter failed")
    return { companies: [], contacts: [] }
  }
}
