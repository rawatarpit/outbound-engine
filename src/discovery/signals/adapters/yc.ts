import pino from "pino"
import axios from "axios"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "debug" })

const ALGOLIA_APP = "45BWZJ1SGC"
const ALGOLIA_KEY = "NzllNTY5MzJiZGM2OTY2ZTQwMDEzOTNhYWZiZGRjODlhYzVkNjBmOGRjNzJiMWM4ZTU0ZDlhYTZjOTJiMjlhMWFuYWx5dGljc1RhZ3M9eWNkYyZyZXN0cmljdEluZGljZXM9WUNDb21wYW55X3Byb2R1Y3Rpb24lMkNZQ0NvbXBhbnlfQnlfTGF1bmNoX0RhdGVfcHJvZHVjdGlvbiZ0YWdGaWx0ZXJzPSU1QiUyMnljZGNfcHVibGljJTIyJTVE"

export interface YCAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
}

export async function ycAdapter(
  config: YCAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 15 } = config

  try {
    const response = await axios.post(
      `https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/*/queries`,
      {
        requests: [{
          indexName: "YCCompany_production",
          query,
          params: "hitsPerPage=" + max_results + "&filters=ycdc_public&facets=%5B%22top_company%22%2C%22tags%22%2C%22batch%22%2C%22industry%22%2C%22regions%22%2C%22status%22%2C%22highlight%22%2C%22is_open_source%22%2C%22nonprofit%22%2C%22black_founded%22%2C%22hispanic_latino_founded%22%2C%22disabled_trans_founded%22%2C%22women_led%22%5D&maxValuesPerFacet=100",
        }],
      },
      {
        headers: {
          "X-Algolia-API-Key": ALGOLIA_KEY,
          "X-Algolia-Application-Id": ALGOLIA_APP,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    )

    const hits = response.data?.results?.[0]?.hits || []
    const companies: DiscoveryCompany[] = hits.map((hit: any) => {
      const name = hit.name || hit.company_name || "Unknown"
      const slug = hit.slug || ""
      const companyUrl = slug ? `https://www.ycombinator.com/companies/${slug}` : ""
      const description = hit.one_liner || hit.description || ""
      const tags: string[] = hit.tags || []
      const batch = hit.batch || ""
      const industry = hit.industry || ""

      const c: any = {
        source: "ycombinator",
        source_url: companyUrl,
        risk: DiscoveryRisk.SAFE_API,
        domain: hit.website || `${slug}.yc.com`,
        name,
        title: name,
        summary: `${description} [YC ${batch}] Industry: ${industry}`,
        signal_type: signal,
        relevance_score: hit.isHiring ? 85 : 70,
        urgency_score: hit.isHiring ? 60 : 40,
        fit_reason: `YC company matching "${query}": ${description} (${batch}, ${industry})${hit.isHiring ? ' — actively hiring!' : ''}`,
        raw: { query, intent_id, signal, tags, batch, industry, isHiring: hit.isHiring, source: "ycombinator" },
      }
      return c as DiscoveryCompany
    })

    logger.info({ query, count: companies.length }, "YC adapter completed")
    return { companies, contacts: [] }
  } catch (err: any) {
    logger.error({ query, error: err.message }, "YC adapter failed")
    return { companies: [], contacts: [] }
  }
}
