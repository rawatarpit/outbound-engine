import { PlaywrightCrawler } from "@crawlee/playwright"
import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"
import pino from "pino"
import * as cheerio from "cheerio"

const logger = pino({ level: "info" })

interface ForumResult {
  title: string
  link: string
  snippet: string
  author?: string
  votes?: string
  source: string
}

interface ForumAdapterConfig extends AdapterConfig {
  maxResults?: number
}

const DEFAULT_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

const MAX_RETRIES = 2

function randomDelay(): number {
  return Math.floor(Math.random() * 3000) + 2000
}

// Dev.to Community
async function fetchDevToSearch(query: string): Promise<ForumResult[]> {
  const results: ForumResult[] = []
  const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]
  const searchUrl = `https://dev.to/search?q=${encodeURIComponent(query)}`

  try {
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
        launchOptions: { headless: true, userAgent },
      },
      async requestHandler({ page }) {
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/',
        })
        await page.setViewportSize({ width: 1920, height: 1080 })
        await page.waitForTimeout(randomDelay())

        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 })
        } catch {}
        await page.waitForTimeout(1000)

        const html = await page.content()
        const $ = cheerio.load(html)

        $("div.search-result, article.search-result, a[href*='/']").each((i, el) => {
          if (i > 20) return
          const $el = $(el)
          const title = $el.find("h3, h2, a").first().text().trim()
          const href = $el.find("a").first().attr("href") || ""
          const snippet = $el.find("p, .description, .excerpt").first().text().trim().slice(0, 200)

          if (title && title.length > 3) {
            results.push({
              title: title.slice(0, 150),
              link: href.startsWith("http") ? href : `https://dev.to${href}`,
              snippet,
              source: "devto",
            })
          }
        })
      },
    })

    await crawler.run([searchUrl])
    logger.info({ stage: "DEVTO_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "DEVTO_ERROR", query, error })
  }

  return results
}

// Stack Overflow
async function fetchStackOverflowSearch(query: string): Promise<ForumResult[]> {
  const results: ForumResult[] = []
  const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]
  const searchUrl = `https://stackoverflow.com/search?q=${encodeURIComponent(query)}&tab=Newest`

  try {
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
        launchOptions: { headless: true, userAgent },
      },
      async requestHandler({ page }) {
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/',
        })
        await page.setViewportSize({ width: 1920, height: 1080 })
        await page.waitForTimeout(randomDelay())

        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 })
        } catch {}
        await page.waitForTimeout(1000)

        const html = await page.content()
        const $ = cheerio.load(html)

        $(".s-post-summary, .question-summary").each((i, el) => {
          if (i > 15) return
          const $el = $(el)
          const title = $el.find(".s-post-summary--content h3 a, .question-hyperlink").first().text().trim()
          const href = $el.find(".s-post-summary--content h3 a, .question-hyperlink").attr("href") || ""
          const snippet = $el.find(".s-post-summary--content .excerpt, .excerpt").first().text().trim().slice(0, 150)

          if (title && title.length > 3) {
            results.push({
              title: title.slice(0, 150),
              link: href.startsWith("http") ? href : `https://stackoverflow.com${href}`,
              snippet,
              source: "stackoverflow",
            })
          }
        })
      },
    })

    await crawler.run([searchUrl])
    logger.info({ stage: "STACKOVERFLOW_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "STACKOVERFLOW_ERROR", query, error })
  }

  return results
}

// HackerNoon
async function fetchHackerNoonSearch(query: string): Promise<ForumResult[]> {
  const results: ForumResult[] = []
  const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]
  const searchUrl = `https://hackernoon.com/search?q=${encodeURIComponent(query)}`

  try {
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
        launchOptions: { headless: true, userAgent },
      },
      async requestHandler({ page }) {
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/',
        })
        await page.setViewportSize({ width: 1920, height: 1080 })
        await page.waitForTimeout(randomDelay())

        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 })
        } catch {}
        await page.waitForTimeout(1000)

        const html = await page.content()
        const $ = cheerio.load(html)

        $("a[data-testid='post-card-title'], h3 a, .post-card a").each((i, el) => {
          if (i > 15) return
          const $el = $(el)
          const title = $el.text().trim()
          const href = $el.attr("href") || ""
          const parent = $el.closest("article, .post-card")
          const snippet = parent.find("p, .excerpt").first().text().trim().slice(0, 150)

          if (title && title.length > 3) {
            results.push({
              title: title.slice(0, 150),
              link: href.startsWith("http") ? href : `https://hackernoon.com${href}`,
              snippet,
              source: "hackernoon",
            })
          }
        })
      },
    })

    await crawler.run([searchUrl])
    logger.info({ stage: "HACKERNOON_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "HACKERNOON_ERROR", query, error })
  }

  return results
}

// Substack
async function fetchSubstackSearch(query: string): Promise<ForumResult[]> {
  const results: ForumResult[] = []
  const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]
  const searchUrl = `https://substack.com/search?q=${encodeURIComponent(query)}`

  try {
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
        launchOptions: { headless: true, userAgent },
      },
      async requestHandler({ page }) {
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/',
        })
        await page.setViewportSize({ width: 1920, height: 1080 })
        await page.waitForTimeout(randomDelay())

        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 })
        } catch {}
        await page.waitForTimeout(1000)

        const html = await page.content()
        const $ = cheerio.load(html)

        $("a[href*='/p/'], h3 a").each((i, el) => {
          if (i > 15) return
          const $el = $(el)
          const title = $el.text().trim()
          const href = $el.attr("href") || ""

          if (title && title.length > 3) {
            results.push({
              title: title.slice(0, 150),
              link: href.startsWith("http") ? href : `https://substack.com${href}`,
              snippet: $el.parent().text().trim().slice(0, 150),
              source: "substack",
            })
          }
        })
      },
    })

    await crawler.run([searchUrl])
    logger.info({ stage: "SUBSTACK_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "SUBSTACK_ERROR", query, error })
  }

  return results
}

// GitHub Topics/Repos
async function fetchGitHubSearch(query: string): Promise<ForumResult[]> {
  const results: ForumResult[] = []
  const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]
  const searchUrl = `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`

  try {
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
        launchOptions: { headless: true, userAgent },
      },
      async requestHandler({ page }) {
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/',
        })
        await page.setViewportSize({ width: 1920, height: 1080 })
        await page.waitForTimeout(randomDelay())

        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 })
        } catch {}
        await page.waitForTimeout(1000)

        const html = await page.content()
        const $ = cheerio.load(html)

        $("a[href*='/'], .repo-list-item a").each((i, el) => {
          if (i > 15) return
          const $el = $(el)
          const title = $el.text().trim()
          const href = $el.attr("href") || ""

          if (href?.includes("/") && !href.includes("search") && title && title.length > 2) {
            results.push({
              title: title.slice(0, 150),
              link: href.startsWith("http") ? href : `https://github.com${href}`,
              snippet: $el.parent().text().trim().slice(0, 150),
              source: "github",
            })
          }
        })
      },
    })

    await crawler.run([searchUrl])
    logger.info({ stage: "GITHUB_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "GITHUB_ERROR", query, error })
  }

  return results
}

// G2 Software Reviews
async function fetchG2Search(query: string): Promise<ForumResult[]> {
  const results: ForumResult[] = []
  const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]
  const searchUrl = `https://www.g2.com/search?q=${encodeURIComponent(query)}`

  try {
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
        launchOptions: { headless: true, userAgent },
      },
      async requestHandler({ page }) {
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/',
        })
        await page.setViewportSize({ width: 1920, height: 1080 })
        await page.waitForTimeout(randomDelay())

        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 })
        } catch {}
        await page.waitForTimeout(1000)

        const html = await page.content()
        const $ = cheerio.load(html)

        $("a[href*='/products/'], h3 a, .product-name a").each((i, el) => {
          if (i > 15) return
          const $el = $(el)
          const title = $el.text().trim()
          const href = $el.attr("href") || ""
          const parent = $el.closest("div, article")
          const snippet = parent.find("p, .description").first().text().trim().slice(0, 150)

          if (title && title.length > 2) {
            results.push({
              title: title.slice(0, 150),
              link: href.startsWith("http") ? href : `https://www.g2.com${href}`,
              snippet,
              source: "g2",
            })
          }
        })
      },
    })

    await crawler.run([searchUrl])
    logger.info({ stage: "G2_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "G2_ERROR", query, error })
  }

  return results
}

// Capterra
async function fetchCapterraSearch(query: string): Promise<ForumResult[]> {
  const results: ForumResult[] = []
  const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]
  const searchUrl = `https://www.capterra.com/search/?q=${encodeURIComponent(query)}`

  try {
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
        launchOptions: { headless: true, userAgent },
      },
      async requestHandler({ page }) {
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/',
        })
        await page.setViewportSize({ width: 1920, height: 1080 })
        await page.waitForTimeout(randomDelay())

        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 })
        } catch {}
        await page.waitForTimeout(1000)

        const html = await page.content()
        const $ = cheerio.load(html)

        $("a[href*='/reviews/'], h3 a, .product-name").each((i, el) => {
          if (i > 15) return
          const $el = $(el)
          const title = $el.text().trim()
          const href = $el.attr("href") || ""

          if (title && title.length > 2) {
            results.push({
              title: title.slice(0, 150),
              link: href.startsWith("http") ? href : `https://www.capterra.com${href}`,
              snippet: $el.parent().text().trim().slice(0, 150),
              source: "capterra",
            })
          }
        })
      },
    })

    await crawler.run([searchUrl])
    logger.info({ stage: "CAPTERRA_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "CAPTERRA_ERROR", query, error })
  }

  return results
}

// Twitter/X Search (via Nitter for alternatives)
async function fetchTwitterSearch(query: string): Promise<ForumResult[]> {
  const results: ForumResult[] = []
  const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]

  const nitterInstances = [
    "nitter.privacydev.net",
    "nitter.poast.org",
    "nitter.onediv.dev",
  ]

  for (const instance of nitterInstances.slice(0, 1)) {
    const searchUrl = `https://${instance}/search?q=${encodeURIComponent(query)}&f=users`

    try {
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
          launchOptions: { headless: true, userAgent },
        },
        async requestHandler({ page }) {
          await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/',
          })
          await page.setViewportSize({ width: 1920, height: 1080 })
          await page.waitForTimeout(randomDelay())

          try {
            await page.waitForLoadState("domcontentloaded", { timeout: 10000 })
          } catch {}
          await page.waitForTimeout(1000)

          const html = await page.content()
          const $ = cheerio.load(html)

          $("a[href*='/'], .tweet-link, .username").each((i, el) => {
            if (i > 10) return
            const $el = $(el)
            const text = $el.text().trim()
            const href = $el.attr("href") || ""

            if (href?.includes("/") && text && text.length > 1 && text.length < 50) {
              results.push({
                title: `@${text.replace("@", "")}`,
                link: `https://twitter.com${href}`,
                snippet: $el.parent().text().trim().slice(0, 150),
                source: "twitter",
              })
            }
          })
        },
      })

      await crawler.run([searchUrl])

      if (results.length > 0) break
    } catch (error) {
      logger.debug({ stage: "TWITTER_ERROR", instance, query })
    }
  }

  logger.info({ stage: "TWITTER_SUCCESS", query, count: results.length })
  return results
}

// SaaS Reviews & Directories
async function fetchSaaSDirectories(query: string): Promise<ForumResult[]> {
  const results: ForumResult[] = []
  const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]

  const directories = [
    { name: "getalfred", url: `https://getalfred.com/search/?q=${encodeURIComponent(query)}` },
    { name: "switchboard", url: `https://www.switchboard.io/search?q=${encodeURIComponent(query)}` },
  ]

  for (const dir of directories) {
    try {
      const crawler = new PlaywrightCrawler({
        maxConcurrency: 1,
        maxRequestRetries: 1,
        preNavigationHooks: [
          async ({ page }) => {
            await page.addInitScript(() => {
              Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
            })
          }
        ],
        launchContext: {
          launchOptions: { headless: true, userAgent },
        },
        async requestHandler({ page }) {
          await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/',
          })
          await page.waitForTimeout(randomDelay())

          try {
            await page.waitForLoadState("domcontentloaded", { timeout: 10000 })
          } catch {}

          const html = await page.content()
          const $ = cheerio.load(html)

          $("a[href*='/'], h3").each((i, el) => {
            if (i > 8) return
            const $el = $(el)
            const title = $el.text().trim()
            const href = $el.attr("href") || ""
            if (title && title.length > 2) {
              results.push({ title, link: href, snippet: "", source: dir.name })
            }
          })
        },
      })

      await crawler.run([dir.url])
    } catch {}
  }

  return results
}

export class ForumAdapter extends DiscoveryAdapter {
  source = "community_forums"
  supportedSignals = [
    SignalType.HIRING,
    SignalType.HIRING_SALES,
    SignalType.HIRING_ENGINEER,
    SignalType.REMOTE_HIRING,
    SignalType.FUNDING,
    SignalType.FUNDING_ANNOUNCEMENT,
    SignalType.LAUNCH,
    SignalType.PRODUCT_LAUNCH,
    SignalType.PAIN,
    SignalType.TECH_USAGE,
    SignalType.GROWTH_ACTIVITY,
    SignalType.EXPANSION,
  ]

  constructor(config: ForumAdapterConfig = {}) {
    super(config)
  }

  override supports(signal: string): boolean {
    const supported = [
      "hiring", "hiring_sales", "hiring_engineer", "remote_hiring",
      "funding", "funding_announcement", "launch", "product_launch",
      "pain", "tech_usage", "growth_activity", "expansion", "advertising", "partnership",
    ]
    return supported.includes(signal)
  }

  async fetch(params: AdapterParams): Promise<FetchResult> {
    const results = await this.executeSearch(params.query, params.signal)
    return {
      raw: results,
      metadata: {
        searchQuery: params.query,
        resultCount: results.length,
        source: "community_forums",
      },
    }
  }

  private async executeSearch(query: string, signal: string): Promise<ForumResult[]> {
    const allResults: ForumResult[] = []

    // Run all searches in parallel
    const [devTo, stackOverflow, hackerNoon, g2, capterra] = await Promise.all([
      fetchDevToSearch(query),
      fetchStackOverflowSearch(query),
      fetchHackerNoonSearch(query),
      fetchG2Search(query),
      fetchCapterraSearch(query),
    ])

    allResults.push(...devTo, ...stackOverflow, ...hackerNoon, ...g2, ...capterra)

    // Add GitHub for tech signals
    if (signal === "tech_usage" || signal === "pain" || query.toLowerCase().includes("tool")) {
      const github = await fetchGitHubSearch(query)
      allResults.push(...github)
    }

    // Add Substack for funding/launch
    if (signal === "funding" || signal === "launch" || query.toLowerCase().includes("announce")) {
      const substack = await fetchSubstackSearch(query)
      allResults.push(...substack)
    }

    logger.info({ stage: "FORUM_SEARCH_COMPLETE", query, totalResults: allResults.length })
    return allResults.slice(0, 50)
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as ForumResult[]
    logger.info({ stage: "FORUM_NORMALIZE", count: items.length })

    return items
      .filter((item) => item.title || item.link)
      .map((item) => {
        const intentType = this.classifyIntent(item.title, item.snippet, item.source)
        const score = this.calculateIntentScore(intentType)
        const domain = this.extractDomain(item.link)

        return this.createOpportunity({
          name: this.extractCompanyName(item.title, domain),
          domain,
          source: item.source || this.source,
          signal: this.mapIntentToSignal(intentType),
          sub_signal: intentType,
          confidence: score,
          metadata: {
            title: item.title,
            snippet: item.snippet,
            url: item.link,
            author: item.author,
          },
        })
      })
  }

  private classifyIntent(title: string, snippet: string, source: string): string {
    const text = (title + " " + snippet).toLowerCase()

    // Source-specific classification
    if (source === "g2" || source === "capterra") return "tool_search"
    if (source === "github") return "tech_usage"
    if (source === "stackoverflow") return "pain"

    //通用关键词
    const hiringKeywords = ["hiring", "job", "opening", "looking for", "seeking", "role", "position", "apply"]
    const painKeywords = ["help", "problem", "issue", "error", "doesn't work", "struggling", "can't", "how to", "why"]
    const toolKeywords = ["tool", "software", "platform", "alternative", "vs ", "recommend", "review", "best"]
    const fundingKeywords = ["raised", "funded", "investment", "seed", "series", "vc", "capital"]
    const launchKeywords = ["launch", "released", "new", "announcing", "public", "beta"]

    for (const kw of fundingKeywords) if (text.includes(kw)) return "funding"
    for (const kw of launchKeywords) if (text.includes(kw)) return "launch"
    for (const kw of hiringKeywords) if (text.includes(kw)) return "hiring"
    for (const kw of toolKeywords) if (text.includes(kw)) return "tool_search"
    for (const kw of painKeywords) if (text.includes(kw)) return "pain"

    return "discussion"
  }

  private calculateIntentScore(intentType: string): number {
    const weights: Record<string, number> = {
      hiring: 0.88,
      hiring_sales: 0.9,
      hiring_engineer: 0.9,
      remote_hiring: 0.85,
      funding: 0.85,
      funding_announcement: 0.88,
      launch: 0.75,
      product_launch: 0.78,
      tool_search: 0.7,
      tech_usage: 0.65,
      pain: 0.82,
      discussion: 0.35,
    }
    return weights[intentType] ?? 0.5
  }

  private mapIntentToSignal(intentType: string): string {
    const mapping: Record<string, string> = {
      hiring: SignalType.HIRING,
      hiring_sales: SignalType.HIRING_SALES,
      hiring_engineer: SignalType.HIRING_ENGINEER,
      remote_hiring: SignalType.REMOTE_HIRING,
      funding: SignalType.FUNDING,
      funding_announcement: SignalType.FUNDING_ANNOUNCEMENT,
      launch: SignalType.LAUNCH,
      product_launch: SignalType.PRODUCT_LAUNCH,
      tool_search: SignalType.TECH_USAGE,
      tech_usage: SignalType.TECH_USAGE,
      pain: SignalType.PAIN,
      growth: SignalType.GROWTH_ACTIVITY,
      expansion: SignalType.EXPANSION,
    }
    return mapping[intentType] || SignalType.PAIN
  }

  private extractCompanyName(title: string, domain?: string): string {
    if (domain) return domain.replace(/^www\./, "").replace(/\..*/, "")
    return title.replace(/[-|–]\s*.*$/, "").trim() || "Unknown"
  }

  private extractDomainFromUrl(url: string): string {
    if (!url) return ""
    try {
      return new URL(url).hostname.replace(/^www\./, "")
    } catch {
      return ""
    }
  }
}

export default ForumAdapter