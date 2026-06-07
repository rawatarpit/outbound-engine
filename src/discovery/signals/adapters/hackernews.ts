import axios from "axios"
import pino from "pino"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "debug" })

export interface HackerNewsAdapterConfig {
  query: string
  intent_id: string
  signal: string
  hitsPerPage?: number
}

export async function hackernewsAdapter(
  config: HackerNewsAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, hitsPerPage = 15 } = config

  try {
    const url = "https://hn.algolia.com/api/v1/search"
    const response = await axios.get(url, {
      params: {
        query,
        tags: "story",
        hitsPerPage,
        attributesToRetrieve: "title,story_text,author,url,created_at_i,objectID,points,num_comments",
      },
      timeout: 10000,
    })

    if (!response.data?.hits) {
      return { companies: [], contacts: [] }
    }

    const companies: DiscoveryCompany[] = response.data.hits
      .filter((hit: any) => hit.title && !hit.title.toLowerCase().includes("show hn:") && !hit.title.toLowerCase().includes("who is hiring?"))
      .map((hit: any) => ({
        source: "hackernews",
        source_url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        risk: DiscoveryRisk.MODERATE_PUBLIC,
        domain: (() => {
          try {
            if (hit.url) return new URL(hit.url).hostname.replace("www.", "")
          } catch {}
          return "unknown.com"
        })(),
        name: hit.title || "Unknown",
        title: hit.title || "",
        summary: (hit.story_text || hit.title || "").substring(0, 200),
        signal_type: signal,
        relevance_score: 50,
        urgency_score: 30,
        fit_reason: `HackerNews match for: ${query}`,
        raw: { query, intent_id, signal, objectID: hit.objectID, points: hit.points },
      }))

    logger.info({ query, count: companies.length }, "HackerNews adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "HackerNews adapter failed")
    return { companies: [], contacts: [] }
  }
}
