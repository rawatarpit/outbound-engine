import pino from "pino"
import { executeScraplingSearch } from "../../../core/utils/scrapling"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "debug" })

export interface SearchAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
  clientId?: string
}

export async function searchAdapter(
  config: SearchAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 10, clientId } = config

  try {
    const results = await executeScraplingSearch(query, "google", max_results)

    const companies: DiscoveryCompany[] = results.map((r, i) => ({
      source: `google_search`,
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
      fit_reason: `Google search result for: ${query}`,
      raw: { query, intent_id, signal },
    }))

    logger.info({ query, count: companies.length }, "Search adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Search adapter failed")
    return { companies: [], contacts: [] }
  }
}
