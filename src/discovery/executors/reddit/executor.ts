import pino from "pino"
import { PlaywrightCrawler } from "@crawlee/playwright"
import { redditSchema, type RedditConfig } from "./schema"
import { transformRedditResults } from "./transform"
import type { ExecutorParams } from "../../registry"
import { withTimeout } from "../../utils/timeout"
import { DiscoveryRisk } from "../../types"
import { DiscoveryError } from "../../errors"
import * as cheerio from "cheerio"

const logger = pino({ level: "info" })

const DEFAULT_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

const MAX_RETRIES = 2

function randomDelay(): number {
  return Math.floor(Math.random() * 3000) + 2000
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
  const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]

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
        const posts: any[] = []

        const crawler = new PlaywrightCrawler({
          maxConcurrency: 1,
          maxRequestRetries: MAX_RETRIES,

          preNavigationHooks: [
            async ({ page }) => {
              await page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
              })
            }
          ],

          launchContext: {
            launchOptions: {
              headless: true,
              userAgent: userAgent,
            },
          },

          async requestHandler({ page, request }) {
            const url = request.url

            await page.setExtraHTTPHeaders({
              'Accept-Language': 'en-US,en;q=0.9',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Referer': 'https://www.google.com/',
            })

            await page.setViewportSize({ width: 1920, height: 1080 })

            const delay = randomDelay()
            await page.waitForTimeout(delay)

            try {
              await page.waitForLoadState("domcontentloaded", { timeout: 20000 })
            } catch {
              logger.warn({ url }, "Page load timeout")
            }

            await page.waitForTimeout(1000)

            const html = await page.content()
            const $ = cheerio.load(html)

            $("div.thing").each((_i, el) => {
              const $el = $(el)
              const title = $el.find("a.title").first().text().trim()
              const link = $el.find("a.title").attr("href") || ""
              const selftext = $el.attr("data-text") || ""
              const author = $el.attr("data-author") || ""
              const score = parseInt($el.find("div.score").attr("data-score") || "0", 10)
              const numComments = parseInt($el.find("a.comments").text().replace(/[^0-9]/g, "") || "0", 10)
              const permalink = $el.find("a.comments").attr("href") || ""
              const over_18 = $el.attr("data-nsfw") === "true"

              if (!includeNSFW && over_18) return

              if (title && title.length > 3) {
                posts.push({
                  id: $el.attr("data-fullname") || Math.random().toString(36),
                  title,
                  selftext,
                  author,
                  subreddit,
                  url: link.startsWith("http") ? link : `https://old.reddit.com${permalink}`,
                  permalink: `https://old.reddit.com${permalink}`,
                  score,
                  num_comments: numComments,
                  over_18,
                  created_utc: Date.now() / 1000,
                })
              }
            })

            $("a.title").each((_i, el) => {
              const $el = $(el)
              const title = $el.text().trim()
              const link = $el.attr("href") || ""
              const parent = $el.closest("div.thing")
              const author = parent.attr("data-author") || ""
              const score = parseInt(parent.find("div.score").attr("data-score") || "0", 10)
              const numComments = parseInt(parent.find("a.comments").text().replace(/[^0-9]/g, "") || "0", 10)

              if (title && title.length > 3 && !posts.find(p => p.title === title)) {
                posts.push({
                  id: Math.random().toString(36),
                  title,
                  selftext: "",
                  author,
                  subreddit,
                  url: link.startsWith("http") ? link : "",
                  permalink: "",
                  score,
                  num_comments: numComments,
                  over_18: false,
                  created_utc: Date.now() / 1000,
                })
              }
            })

            logger.info({ url, count: posts.length }, "Reddit page scraped")
          },

          failedRequestHandler({ request, log }) {
            log.error(`Request ${request.url} failed multiple times`)
          },
        })

        await crawler.run([endpoint])

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

  if (allPosts.length === 0) {
    throw new DiscoveryError(
      "SOURCE_EXTRACTION_FAILED: No Reddit results extracted",
      "retryable"
    )
  }

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

function buildEndpoint(params: {
  query: string
  subreddit: string
  sort: string
  time: string
  limit: number
}) {
  const { query, subreddit, sort, time, limit } = params

  const base = `https://old.reddit.com/r/${subreddit}/search.json`

  const url = new URL(base)

  url.searchParams.set("q", query)
  url.searchParams.set("sort", sort)
  url.searchParams.set("t", time)
  url.searchParams.set("limit", String(limit))
  url.searchParams.set("restrict_sr", "1")

  return url.toString()
}
