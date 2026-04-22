import pino from "pino"
import { redditSchema, type RedditConfig } from "./schema"
import { transformRedditResults } from "./transform"
import type { ExecutorParams } from "../../registry"
import { withTimeout } from "../../utils/timeout"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "info" })

interface RedditApiResponse {
  data: {
    children: {
      data: any
    }[]
  }
}

export async function redditExecutor(
  params: ExecutorParams<RedditConfig>
) {
  const start = Date.now()

  const { sourceId, brandId, config } = params

  const parsed = redditSchema.parse(config)

  const {
    keywords,
    subreddits,
    sort,
    time,
    limit,
    includeNSFW
  } = parsed

  logger.info(
    { sourceId, brandId, keywords, subreddits },
    "Reddit discovery execution started"
  )

  let rateLimited = false
  let sourceHealth: "healthy" | "degraded" | "blocked" = "healthy"

  const allPosts: any[] = []
  const seen = new Set<string>()

  for (const subreddit of subreddits) {
    for (const keyword of keywords) {
      const endpoint = buildEndpoint({
        query: keyword,
        subreddit,
        sort,
        time,
        limit
      })

      logger.info(
        { sourceId, subreddit, keyword },
        "Reddit query execution"
      )

      try {
        const response = await withTimeout(
          fetch(endpoint, {
            headers: {
              "User-Agent":
                "ai-outbound-engine/2.0 (contact: admin@example.com)"
            }
          }),
          15000
        )

        if (response.status === 429) {
          rateLimited = true
          sourceHealth = "degraded"
          continue
        }

        if (response.status === 403) {
          sourceHealth = "blocked"
          continue
        }

        if (!response.ok) {
          logger.warn(
            { sourceId, subreddit, keyword, status: response.status },
            "Reddit non-OK response"
          )
          continue
        }

        const json: RedditApiResponse = await response.json()

        const posts = json.data.children
          .map(c => c.data)
          .filter(post => {
            if (!includeNSFW && post.over_18) return false
            return true
          })

        for (const post of posts) {
          if (!seen.has(post.id)) {
            seen.add(post.id)
            allPosts.push(post)
          }
        }

      } catch (err) {
        logger.warn(
          { sourceId, subreddit, keyword, err },
          "Reddit query failed"
        )
      }
    }
  }

  logger.info(
    { sourceId, total_posts: allPosts.length },
    "Reddit aggregation complete"
  )

  // IMPORTANT: transform now emits companies (not contacts)
  const result = transformRedditResults(allPosts, "multi-query")

  const duration = Date.now() - start

  return {
    ...result,
    meta: {
      ...result.meta,
      executor: "reddit",
      risk: "MODERATE_PUBLIC" as any,
      total_fetched: allPosts.length,
      total_companies: result.companies?.length ?? 0,
      rate_limited: rateLimited,
      source_health: sourceHealth,
      duration_ms: duration
    }
  }
}

/* ---------------- ENDPOINT BUILDER ---------------- */

function buildEndpoint(params: {
  query: string
  subreddit: string
  sort: string
  time: string
  limit: number
}) {
  const { query, subreddit, sort, time, limit } = params

  const base = `https://www.reddit.com/r/${subreddit}/search.json`

  const url = new URL(base)

  url.searchParams.set("q", query)
  url.searchParams.set("sort", sort)
  url.searchParams.set("t", time)
  url.searchParams.set("limit", String(limit))
  url.searchParams.set("restrict_sr", "1")

  return url.toString()
}