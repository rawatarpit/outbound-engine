import pino from "pino"
import { executeScraplingSearch } from "../../../core/utils/scrapling"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "debug" })

export interface JobsAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
}

export async function jobsAdapter(
  config: JobsAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 10 } = config

  try {
    const results = await executeScraplingSearch(query, "jobs", max_results)

    const companies: DiscoveryCompany[] = results.map((r, i) => ({
      source: `google_jobs`,
      source_url: "",
      risk: DiscoveryRisk.MODERATE_PUBLIC,
      domain: (() => {
        const name = (r.company || r.title || "").toLowerCase().replace(/[^a-z0-9]/g, "")
        return name ? `${name}.com` : "unknown.com"
      })(),
      name: r.company || r.title || "Unknown",
      signal_type: "hiring",
      relevance_score: 60,
      urgency_score: 50,
      fit_reason: `Job posting signal: ${query}`,
      summary: `Hiring: ${r.title || r.company || "Unknown"}`,
      raw: { query, intent_id, signal },
    }))

    logger.info({ query, count: companies.length }, "Jobs adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Jobs adapter failed")
    return { companies: [], contacts: [] }
  }
}
