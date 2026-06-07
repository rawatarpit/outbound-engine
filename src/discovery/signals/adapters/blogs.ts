import pino from "pino"
import { executeScraplingSearch } from "../../../core/utils/scrapling"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "debug" })

const BLOG_DOMAINS = [
  "medium.com",
  "dev.to",
  "hashnode.com",
  "blog.google",
  "stackoverflow.blog",
  "techcrunch.com",
  "thenextweb.com",
  "venturebeat.com",
]

export interface BlogsAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
}

function siteQuery(query: string): string {
  const siteClause = BLOG_DOMAINS.map(s => `site:${s}`).join(" OR ")
  return `(${siteClause}) ${query}`
}

export async function blogsAdapter(
  config: BlogsAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 10 } = config

  try {
    const results = await executeScraplingSearch(siteQuery(query), "google", max_results)

    const companies: DiscoveryCompany[] = results.map((r) => ({
      source: "blogs",
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
      relevance_score: 50,
      urgency_score: 30,
      fit_reason: `Blog/article match for: ${query}`,
      raw: { query, intent_id, signal },
    }))

    logger.info({ query, count: companies.length }, "Blogs adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Blogs adapter failed")
    return { companies: [], contacts: [] }
  }
}
