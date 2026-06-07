import pino from "pino"
import axios from "axios"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"
import { withRateLimit } from "../../utils/rate-limiter"

const logger = pino({ level: "debug" })

export interface PushshiftAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
  subreddits?: string[]
}

export async function pushshiftAdapter(
  config: PushshiftAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 25, subreddits } = config

  try {
    const subFilter = subreddits && subreddits.length > 0
      ? `&subreddit=${subreddits.join(",")}`
      : "&subreddit=startups,entrepreneur,smallbusiness,techstartups,SaaS"

    const searchUrl = `https://api.pushshift.io/reddit/search/submission?q=${encodeURIComponent(query)}${subFilter}&size=${max_results}&sort=desc&sort_type=created_utc`

    const rawResults: any[] = await withRateLimit("pushshift", async () => {
      const response = await axios.get(searchUrl, {
        headers: {
          "User-Agent": "OutboundEngine/1.0 (discovery agent; research purposes)",
          "Accept": "application/json",
        },
        timeout: 15000,
      })

      if (!response.data?.data || !Array.isArray(response.data.data)) {
        return []
      }

      const results: any[] = []
      const seen = new Set<string>()

      for (const post of response.data.data) {
        const title = (post.title || "").trim()
        const selftext = (post.selftext || "").trim()
        const subreddit = post.subreddit || "unknown"
        const author = post.author || "[deleted]"

        if (!title || seen.has(title)) continue
        seen.add(title)

        const combined = `${title} ${selftext}`
        const companyNameMatch = combined.match(/(?:my startup|our company|at\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?))\b/)
        const companyName = companyNameMatch ? companyNameMatch[1] : title.split(/[-–—|]/)[0]?.trim() || title

        results.push({
          source: `pushshift_${subreddit}`,
          source_url: `https://reddit.com/r/${subreddit}/comments/${post.id || ""}`,
          risk: DiscoveryRisk.MODERATE_PUBLIC,
          domain: "unknown.com",
          name: companyName,
          title,
          summary: selftext.substring(0, 500) || title,
          signal_type: "pain",
          relevance_score: 55,
          urgency_score: 40,
          fit_reason: `Reddit (via Pushshift) in r/${subreddit}: ${title.substring(0, 200)}`,
          raw: { query, intent_id, signal, subreddit, author, post_id: post.id, created_utc: post.created_utc },
        })
      }

      return results
    })

    const limited = rawResults.slice(0, max_results)
    const companies: DiscoveryCompany[] = limited.map((c: any) => c as DiscoveryCompany)

    logger.info({ query, count: companies.length }, "Pushshift adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Pushshift adapter failed")
    return { companies: [], contacts: [] }
  }
}
