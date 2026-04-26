import { PlaywrightCrawler } from "@crawlee/playwright"
import { SignalType, SIGNAL_WEIGHTS } from "../types"
import type { Opportunity } from "../types"
import { DiscoveryAdapter, AdapterParams, FetchResult, AdapterConfig } from "../adapter"
import pino from "pino"
import * as cheerio from "cheerio"

const logger = pino({ level: "debug" })

const DEFAULT_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

const MAX_RETRIES = 3
const MAX_CONCURRENCY = 2

interface CrawleeAdapterConfig extends AdapterConfig {
  stealth?: boolean
  maxConcurrency?: number
  userAgents?: string[]
}

interface CrawleeSearchResult {
  title: string
  link: string
  snippet: string
  extracted_text?: string
  position?: number
  source?: string
}

export class CrawleeAdapter extends DiscoveryAdapter {
  source = "crawlee"
  supportedSignals = [
    SignalType.HIRING,
    SignalType.HIRING_ENGINEER,
    SignalType.HIRING_SALES,
    SignalType.REMOTE_HIRING,
    SignalType.HIRING_AGENCY,
    SignalType.PAIN,
    SignalType.OUTBOUND_PAIN,
    SignalType.GROWTH_ACTIVITY,
    SignalType.TECH_USAGE,
    SignalType.FUNDING,
    SignalType.FUNDING_ANNOUNCEMENT,
    SignalType.LAUNCH,
    SignalType.PRODUCT_LAUNCH,
    SignalType.ADVERTISING,
    SignalType.PARTNERSHIP,
    SignalType.EXPANSION,
    SignalType.TEAM_GROWTH,
    SignalType.ACQUISITION,
    SignalType.AUTOMATION_NEED,
  ]

  private stealth: boolean
  private maxConcurrency: number
  private userAgents: string[]

  constructor(config: CrawleeAdapterConfig = {}) {
    super(config)
    this.stealth = config.stealth ?? true
    this.maxConcurrency = config.maxConcurrency ?? MAX_CONCURRENCY
    this.userAgents = config.userAgents ?? DEFAULT_USER_AGENTS

    logger.info(
      { stealth: this.stealth, maxConcurrency: this.maxConcurrency },
      "CrawleeAdapter initialized",
    )
  }

  override supports(signal: string): boolean {
    return this.supportedSignals.includes(signal as SignalType)
  }

  async fetch(params: AdapterParams): Promise<FetchResult> {
    logger.info({ query: params.query, signal: params.signal }, "CrawleeAdapter fetch")

    const urls = this.buildSearchUrls(params.query, params.signal)
    const results = await this.crawlUrls(urls)

    return {
      raw: results,
      metadata: {
        searchQuery: params.query,
        resultCount: results.length,
        source: "crawlee",
        adapter: "CrawleeAdapter",
      },
    }
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as CrawleeSearchResult[]
    logger.info({ count: items.length }, "Normalizing Crawlee results")

    return items
      .filter((item) => item.title || item.link)
      .map((item) => {
        const intentType = this.classifyIntent(item.title, item.snippet)
        const score = this.calculateIntentScore(intentType)
        const domain = this.extractDomainFromUrl(item.link)

        return this.createOpportunity({
          name: this.extractCompanyName(item.title, domain),
          domain,
          source: this.source,
          signal: this.mapIntentToSignal(intentType),
          sub_signal: intentType,
          confidence: score,
          metadata: {
            title: item.title,
            snippet: item.snippet,
            url: item.link,
            extracted_text: item.extracted_text,
            intent_type: intentType,
          },
        })
      })
  }

  protected createOpportunity(
    partial: Partial<Opportunity> & Pick<Opportunity, "name" | "source" | "signal" | "confidence">,
  ): Opportunity {
    return {
      entity_type: "company",
      confidence: 0.5,
      ...partial,
    }
  }

  private buildSearchUrls(query: string, signal: string): string[] {
    const encodedQuery = encodeURIComponent(query.split("site:").slice(0, 1).join("").trim().slice(0, 40))

    const urls: string[] = []

    // Only use sites that don't block - RemoteOK and WeWorkRemotely are most reliable
    if (signal === "hiring" || signal === "hiring_sales" || signal === "hiring_engineer" || signal === "remote_hiring") {
      urls.push(
        `https://remoteok.com/remote-jobs?q=${encodedQuery}`,
        `https://weworkremotely.com/categories/remote-jobs?q=${encodedQuery}`,
      )
    } else if (signal === "funding" || signal === "funding_announcement") {
      urls.push(
        `https://news.ycombinator.com/newest?q=${encodedQuery}`,
        `https://www.indiehackers.com/search?q=${encodedQuery}`,
      )
    } else if (signal === "launch" || signal === "product_launch") {
      urls.push(
        `https://www.producthunt.com/search?q=${encodedQuery}`,
        `https://www.indiehackers.com/search?q=${encodedQuery}`,
      )
    } else {
      // Default - use only reliable sources
      urls.push(
        `https://www.indiehackers.com/search?q=${encodedQuery}`,
        `https://news.ycombinator.com/newest?q=${encodedQuery}`,
        `https://remoteok.com/remote-jobs?q=${encodedQuery}`,
        `https://weworkremotely.com/categories/remote-jobs?q=${encodedQuery}`,
        `https://www.producthunt.com/search?q=${encodedQuery}`,
      )
    }

    return urls.slice(0, 4) // Limit to 4 sources
  }

  private async crawlUrls(urls: string[]): Promise<CrawleeSearchResult[]> {
    const allResults: CrawleeSearchResult[] = []

    const crawler = new PlaywrightCrawler({
      maxConcurrency: this.maxConcurrency,
      maxRequestRetries: MAX_RETRIES,

      launchContext: {
        launchOptions: {
          headless: true,
          userAgent: this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
        },
      },

      async requestHandler({ page, request }) {
        const url = request.url

        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 })
        } catch {
          logger.warn({ url }, "Page load timeout")
        }

        const title = await page.title()
        const html = await page.content()

        const results = extractSearchResults(html, url)

        allResults.push(...results)

        logger.info({ url, title, resultCount: results.length }, "Crawled page")
      },

      failedRequestHandler({ request, log }) {
        log.error(`Request ${request.url} failed multiple times`)
      },
    })

    await crawler.run(urls)

    logger.info({ totalResults: allResults.length }, "Crawling complete")

    return allResults.slice(0, 50)
  }

  private classifyIntent(title: string, snippet: string): string {
    const text = (title + " " + snippet).toLowerCase()

    const hiringKeywords = ["hire", "recruit", "job", "vacancy", "position", "apply", "application", "looking for", "seeking"]
    const painKeywords = ["struggling", "can't", "help", "frustrated", "problem", "need help", "how to", "looking for", "hard to", "failing"]
    const toolSearchKeywords = ["recommend", "best tool", "alternativ", "vs ", "comparison", "review", "switching to", "migrating"]
    const fundingKeywords = ["raised", "funding", "series", "invested", "seed", "venture", "capital", "backed"]
    const launchKeywords = ["launch", "released", "announcing", "new product", "beta", "public"]
    const growthKeywords = ["scaling", "growing", "growth", "expanding", "hired", "team", "revenue"]
    const remoteKeywords = ["remote", "work from home", "distributed", "anywhere"]

    for (const kw of fundingKeywords) {
      if (text.includes(kw)) return "funding"
    }
    for (const kw of launchKeywords) {
      if (text.includes(kw)) return "launch"
    }
    for (const kw of growthKeywords) {
      if (text.includes(kw)) return "growth"
    }
    for (const kw of remoteKeywords) {
      if (text.includes(kw)) return "remote_hiring"
    }
    for (const kw of hiringKeywords) {
      if (text.includes(kw)) return "hiring"
    }
    for (const kw of toolSearchKeywords) {
      if (text.includes(kw)) return "tool_search"
    }
    for (const kw of painKeywords) {
      if (text.includes(kw)) return "pain"
    }
    return "discussion"
  }

  private calculateIntentScore(intentType: string): number {
    const weights: Record<string, number> = {
      hiring: 0.9,
      hiring_sales: 0.92,
      hiring_engineer: 0.92,
      remote_hiring: 0.88,
      hiring_agency: 0.75,
      pain: 0.85,
      tool_search: 0.75,
      funding: 0.85,
      funding_announcement: 0.88,
      launch: 0.75,
      product_launch: 0.78,
      growth: 0.7,
      expansion: 0.72,
      acquisition: 0.8,
    }
    return weights[intentType] ?? 0.5
  }

  private mapIntentToSignal(intentType: string): string {
    const mapping: Record<string, string> = {
      pain: SignalType.PAIN,
      hiring: SignalType.HIRING,
      hiring_sales: SignalType.HIRING_SALES,
      hiring_engineer: SignalType.HIRING_ENGINEER,
      remote_hiring: SignalType.REMOTE_HIRING,
      hiring_agency: SignalType.HIRING_AGENCY,
      tool_search: SignalType.TECH_USAGE,
      funding: SignalType.FUNDING,
      funding_announcement: SignalType.FUNDING_ANNOUNCEMENT,
      launch: SignalType.LAUNCH,
      product_launch: SignalType.PRODUCT_LAUNCH,
      growth: SignalType.GROWTH_ACTIVITY,
      expansion: SignalType.EXPANSION,
      acquisition: SignalType.ACQUISITION,
    }
    return mapping[intentType] ?? SignalType.PAIN
  }

  private extractCompanyName(title: string, domain?: string): string {
    if (domain) {
      return domain.replace(/^www\./, "").replace(/\..*/, "")
    }
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

function extractSearchResults(html: string, url: string): CrawleeSearchResult[] {
  const results: CrawleeSearchResult[] = []
  const $ = cheerio.load(html)

  const isIH = url.includes("indiehackers.com")
  const isHN = url.includes("ycombinator.com")
  const isRemoteOk = url.includes("remoteok.com")
  const isWellfound = url.includes("wellfound.com")
  const isWeWorkRemotely = url.includes("weworkremotely.com")
  const isProductHunt = url.includes("producthunt.com")
  const isAngel = url.includes("angel.co")

  if (isIH) {
    // Indie Hackers - posts, questions, forum
    $("a[href*='/post/']").each((_i, el) => {
      const $el = $(el)
      const href = $el.attr("href") || ""
      const text = $el.text().trim()

      if (text && text.length > 3 && text.length < 150) {
        results.push({
          title: text,
          link: href.startsWith("http") ? href : `https://www.indiehackers.com${href}`,
          snippet: $el.parent().text().trim().slice(0, 200),
          source: "indiehackers",
        })
      }
    })
    $("a[href*='/ask/']").each((_i, el) => {
      const $el = $(el)
      const href = $el.attr("href") || ""
      const text = $el.text().trim()

      if (text && text.length > 3 && text.length < 150) {
        results.push({
          title: text,
          link: href.startsWith("http") ? href : `https://www.indiehackers.com${href}`,
          snippet: $el.parent().text().trim().slice(0, 200),
          source: "indiehackers",
        })
      }
    })
  } else if (isHN) {
    // Hacker News - stories and jobs
    $("tr.athing, tr.job").each((_i, el) => {
      const $el = $(el)
      const title = $el.find("a.storylink, a.titlelink").text().trim()
      const link = $el.find("a.storylink, a.titlelink").attr("href") || ""
      
      if (title) {
        results.push({
          title,
          link,
          snippet: $el.find("div.subtext, span.ycombinator").text().trim(),
          source: "hackernews",
        })
      }
    })
    $("a[href*='vote']").each((_i, el) => {
      const $el = $(el)
      const parent = $el.closest("tr")
      const title = parent.find("a.storylink, a.titlelink").text().trim()
      const link = parent.find("a.storylink, a.titlelink").attr("href") || ""
      
      if (title && title.length > 3) {
        results.push({
          title,
          link,
          snippet: parent.find("div.subtext").text().trim(),
          source: "hackernews",
        })
      }
    })
  } else if (isRemoteOk) {
    // RemoteOK - job listings
    $("h2, h3, .job-title, [data-testid='job-title']").each((_i, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      const linkEl = $el.find("a").first()
      const href = linkEl.length ? linkEl.attr("href") || "" : ""
      const companyEl = $el.next().find("a, .company, .employer")
      const company = companyEl.length ? companyEl.text().trim() : ""

      if (text && text.length > 3) {
        results.push({
          title: text,
          link: href.startsWith("http") ? href : `https://remoteok.com${href}`,
          snippet: company,
          source: "remoteok",
        })
      }
    })
    $("a[href*='/jobs/']").each((_i, el) => {
      const $el = $(el)
      const href = $el.attr("href") || ""
      const text = $el.text().trim()

      if (text && text.length > 5 && !text.includes("apply") && !text.includes("›")) {
        results.push({
          title: text.slice(0, 100),
          link: href.startsWith("http") ? href : `https://remoteok.com${href}`,
          snippet: "",
          source: "remoteok",
        })
      }
    })
  } else if (isWellfound) {
    // Wellfound (formerly AngelList) - jobs and startups
    $("a[href*='/j/'], a[href*='/startups/']").each((_i, el) => {
      const $el = $(el)
      const href = $el.attr("href") || ""
      const text = $el.text().trim()
      const parent = $el.closest("div, article, li")
      const parentText = parent.length ? parent.text().trim().slice(0, 200) : ""

      if (text && text.length > 3 && text.length < 150) {
        results.push({
          title: text,
          link: href.startsWith("http") ? href : `https://wellfound.com${href}`,
          snippet: parentText,
          source: "wellfound",
        })
      }
    })
    $("h2, h3, [data-testid='job-title'], .job-title").each((_i, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      const linkEl = $el.find("a").first()
      const href = linkEl.length ? linkEl.attr("href") || "" : ""

      if (text && text.length > 3 && text.length < 150) {
        results.push({
          title: text,
          link: href.startsWith("http") ? href : `https://wellfound.com${href}`,
          snippet: "",
          source: "wellfound",
        })
      }
    })
  } else if (isWeWorkRemotely) {
    // We Work Remotely
    $("h2, h3, .job-title, a[href*='/jobs/']").each((_i, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      const href = $el.attr("href") || ""

      if (text && text.length > 3 && text.length < 150) {
        results.push({
          title: text,
          link: href.startsWith("http") ? href : `https://weworkremotely.com${href}`,
          snippet: $el.parent().text().trim().slice(0, 200),
          source: "weworkremotely",
        })
      }
    })
  } else if (isProductHunt) {
    // Product Hunt
    $("h3[data-testid='product-name'], h3, .product-name, a[href*='/products/']").each((_i, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      const href = $el.attr("href") || ""
      const parent = $el.closest("[data-testid='product-card']")
      const tagline = parent.find(".tagline, .description").text().trim()

      if (text && text.length > 2 && text.length < 150) {
        results.push({
          title: text,
          link: href.startsWith("http") ? href : `https://www.producthunt.com${href}`,
          snippet: tagline.slice(0, 300),
          source: "producthunt",
        })
      }
    })
  } else if (isAngel) {
    // AngelList
    $("a[href*='/jobs/'], h3, .job-title").each((_i, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      const href = $el.attr("href") || ""

      if (text && text.length > 3 && text.length < 150) {
        results.push({
          title: text,
          link: href.startsWith("http") ? href : `https://angel.co${href}`,
          snippet: $el.parent().text().trim().slice(0, 200),
          source: "angellist",
        })
      }
    })
  } else {
    // Generic fallback
    $("a[href]").each((_i, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      const href = $el.attr("href") || ""

      if (text && text.length > 5 && href.match(/^https?:\/\//)) {
        results.push({
          title: text.slice(0, 100),
          link: href,
          snippet: $el.parent().text().trim().slice(0, 200),
          source: "crawlee",
        })
      }
    })
  }

  return results
}