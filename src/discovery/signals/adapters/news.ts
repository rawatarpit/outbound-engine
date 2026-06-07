import pino from "pino"
import { executeScraplingSearch } from "../../../core/utils/scrapling"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "debug" })

export interface NewsAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
}

const NEWS_QUERY_TEMPLATES = [
  "{keyword} raises series",
  "{keyword} partnership announced",
  "{keyword} launches new",
  "{keyword} expands to",
  "{keyword} funding round",
  "{keyword} acquisition",
  "{keyword} growth",
  "{keyword} new office",
]

export async function newsAdapter(
  config: NewsAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 10 } = config

  try {
    const results = await executeScraplingSearch(query, "news", max_results)

    const companies: DiscoveryCompany[] = results.map((r, i) => ({
      source: `google_news`,
      source_url: r.url || "",
      risk: DiscoveryRisk.MODERATE_PUBLIC,
      domain: (() => {
        if (r.url) {
          try {
            return new URL(r.url).hostname.replace("www.", "")
          } catch {}
        }
        return "unknown.com"
      })(),
      name: r.title || "Unknown",
      title: r.title || "",
      summary: r.title || "",
      signal_type: signal,
      relevance_score: 50,
      urgency_score: 30,
      fit_reason: `Google News match for: ${query}`,
      raw: { query, intent_id, signal },
    }))

    logger.info({ query, count: companies.length }, "News adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "News adapter failed")
    return { companies: [], contacts: [] }
  }
}
