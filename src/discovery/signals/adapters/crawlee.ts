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
    SignalType.PAIN,
    SignalType.GROWTH_ACTIVITY,
    SignalType.TECH_USAGE,
    SignalType.FUNDING,
    SignalType.LAUNCH,
    SignalType.ADVERTISING,
    SignalType.PARTNERSHIP,
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

  private buildSearchUrls(query: string, _signal: string): string[] {
    const encodedQuery = encodeURIComponent(query)

    const urls = [
      `https://www.indiehackers.com/search?q=${encodedQuery}`,
      `https://news.ycombinator.com/newest?q=${encodedQuery}`,
      `https://remoteok.com/remote-jobs?q=${encodedQuery}`,
    ]

    return urls
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

    const hiringKeywords = ["hire", "recruit", "job", "vacancy", "position", "apply", "application"]
    const painKeywords = ["struggling", "can't", "help", "frustrated", "problem", "need help", "how to", "looking for"]
    const toolSearchKeywords = ["recommend", "best tool", "alternativ", "vs ", "comparison", "review"]

    for (const kw of hiringKeywords) {
      if (text.includes(kw)) return "hiring"
    }
    for (const kw of painKeywords) {
      if (text.includes(kw)) return "pain"
    }
    for (const kw of toolSearchKeywords) {
      if (text.includes(kw)) return "tool_search"
    }
    return "discussion"
  }

  private calculateIntentScore(intentType: string): number {
    const weights: Record<string, number> = {
      hiring: 0.9,
      pain: 0.85,
      tool_search: 0.75,
      funding: 0.8,
      launch: 0.7,
      growth_activity: 0.6,
    }
    return weights[intentType] ?? 0.5
  }

  private mapIntentToSignal(intentType: string): string {
    const mapping: Record<string, string> = {
      pain: SignalType.PAIN,
      hiring: SignalType.HIRING,
      tool_search: SignalType.TECH_USAGE,
      funding: SignalType.FUNDING,
      launch: SignalType.LAUNCH,
      growth_activity: SignalType.GROWTH_ACTIVITY,
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

  if (isIH) {
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
    $("h3, h2").each((_i, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      const linkEl = $el.find("a").first()
      const href = linkEl.length ? linkEl.attr("href") || "" : ""

      if (text && text.length > 3 && text.length < 150) {
        results.push({
          title: text,
          link: href.startsWith("http") ? href : `https://www.indiehackers.com${href}`,
          snippet: "",
          source: "indiehackers",
        })
      }
    })
  } else if (isHN) {
    $("tr.athing").each((_i, el) => {
      const $el = $(el)
      const title = $el.find("a.storylink").text().trim()
      const link = $el.find("a.storylink").attr("href") || ""

      if (title) {
        results.push({
          title,
          link,
          snippet: $el.siblings().find("div.subtext").text().trim(),
          source: "hackernews",
        })
      }
    })
  } else if (isRemoteOk) {
    $("h2, h3, .job-title").each((_i, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      const linkEl = $el.find("a").first()
      const href = linkEl.length ? linkEl.attr("href") || "" : ""
      const companyEl = $el.next().find("a, .company")
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
          link: `https://remoteok.com${href}`,
          snippet: "",
          source: "remoteok",
        })
      }
    })
  } else {
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