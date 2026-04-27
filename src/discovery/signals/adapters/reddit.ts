import { PlaywrightCrawler } from "@crawlee/playwright"
import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"
import pino from "pino"
import * as cheerio from "cheerio"

const logger = pino({ level: "debug" })

const DEFAULT_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

const MAX_RETRIES = 2

function randomDelay(): number {
  return Math.floor(Math.random() * 3000) + 2000
}

interface RedditConfig extends AdapterConfig {
  subreddits?: string
}

interface RedditPost {
  title: string
  selftext: string
  author: string
  subreddit: string
  url: string
  score: number
  num_comments: number
  created_utc: number
}

export class RedditAdapter extends DiscoveryAdapter {
  source = "reddit"
  supportedSignals: string[] = ["pain", "growth_activity", "outbound_pain"]

  private baseUrl = "https://old.reddit.com"

  constructor(config: RedditConfig = {}) {
    super(config)
  }

  override supports(signal: string): boolean {
    return this.supportedSignals.includes(signal)
  }

  async fetch(params: AdapterParams): Promise<FetchResult> {
    const subreddits = (this.config.subreddits || "all") as string
    const allResults: any[] = []
    const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]

    const subredditsList = subreddits === "all" 
      ? ["sales", "startups", "smallbusiness", "b2b", "entrepreneur", "SaaS"]
      : subreddits.split(",").map(s => s.trim())

    for (const subreddit of subredditsList) {
      const url = `${this.baseUrl}/r/${subreddit}/search.json?q=${encodeURIComponent(params.query)}&sort=new&limit=25`

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
          const delay = randomDelay()
          await page.waitForTimeout(delay)

          await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': 'https://www.google.com/',
          })

          await page.setViewportSize({ width: 1920, height: 1080 })

          try {
            await page.waitForLoadState("domcontentloaded", { timeout: 20000 })
          } catch {
            logger.warn({ url: request.url }, "Page load timeout")
          }

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

            if (title && title.length > 3) {
              allResults.push({
                title,
                selftext: selftext.slice(0, 500),
                author,
                subreddit,
                url: link.startsWith("http") ? link : `https://old.reddit.com${permalink}`,
                score,
                num_comments: numComments,
                created_utc: Date.now() / 1000,
              })
            }
          })
        },

        failedRequestHandler({ request, log }) {
          logger.error(`Request ${request.url} failed: ${request.url}`)
        },
      })

      try {
        await crawler.run([url])
      } catch (err) {
        logger.error({ subreddit, query: params.query, error: err }, "Reddit crawl failed")
      }
    }

    logger.info({ query: params.query, count: allResults.length }, "Reddit fetch complete")

    return {
      raw: allResults,
      metadata: {
        searchQuery: params.query,
        subreddits,
        resultCount: allResults.length,
      },
    }
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as RedditPost[]

    if (items.length === 0) {
      throw new Error("SOURCE_EXTRACTION_FAILED: No Reddit results extracted")
    }

    return items
      .map((item): Opportunity | null => {
        const domain = item.url ? this.extractDomain(item.url) : undefined
        const authorDomain = item.author

        if (!domain && !authorDomain) return null

        const signal: SignalType =
          item.title.toLowerCase().includes("problem") ||
          item.title.toLowerCase().includes("struggling") ||
          item.title.toLowerCase().includes("frustrat") ||
          item.title.toLowerCase().includes("not working") ||
          item.title.toLowerCase().includes("help")
            ? SignalType.PAIN
            : SignalType.GROWTH_ACTIVITY

        return {
          entity_type: "company" as const,
          name: domain?.replace(/^www\./, "").replace(/\..*/, "") || item.author,
          domain,
          source: this.source,
          signal,
          sub_signal: "reddit_post",
          confidence: this.parseConfidence(item.score / 1000),
          metadata: {
            title: item.title,
            body: item.selftext?.slice(0, 500),
            subreddit: item.subreddit,
            comments: item.num_comments,
          },
        }
      })
      .filter((o): o is Opportunity => o !== null)
  }
}
