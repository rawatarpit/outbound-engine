import { setTimeout } from "timers/promises"
import axios from "axios"
import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"
import * as cheerio from "cheerio"
import pino from "pino"

const logger = pino({ level: "info" })
const DEBUG_MODE = process.env.SCRAPER_DEBUG === "true"

interface ScrapedResult {
  url: string
  title: string
  raw_html: string
  text_content: string
  metadata: Record<string, string>
  success: boolean
  error?: string
  source: "apify" | "scraperapi" | "direct" | "fallback"
}

interface ScraperConfig {
  apifyApiKey?: string
  scraperApiKey?: string
  timeout?: number
  retries?: number
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
]

let scraperConfig: ScraperConfig = { timeout: 20000, retries: 3 }

function initScraper(config: ScraperConfig): void {
  scraperConfig = { ...scraperConfig, ...config }
  logger.info({ stage: "SCRAPER_INIT" })
}

function extractText(html: string, maxLength: number = 5000): string {
  const $ = cheerio.load(html)
  $("script, style, nav, footer, header, aside, noscript, iframe").remove()
  const text = $("main, article, .content, .hero, .main, body").first().text().slice(0, maxLength)
  return text.trim() || $("body").text().slice(0, maxLength).trim()
}

function extractTitle(html: string): string {
  const $ = cheerio.load(html)
  return $("h1").first().text().trim() || $("title").text().trim() || "Unknown"
}

async function scrapeUrl(url: string): Promise<ScrapedResult> {
  logger.info({ stage: "SCRAPE_START", url })
  
  for (let attempt = 0; attempt < (scraperConfig.retries || 3); attempt++) {
    if (attempt > 0) {
      const delay = Math.pow(2, attempt) * 1000
      await setTimeout(delay)
    }

    // Try ScraperAPI first
    if (scraperConfig.scraperApiKey) {
      try {
        const response = await axios.get(
          `https://api.scraperapi.com?api_key=${scraperConfig.scraperApiKey}&url=${encodeURIComponent(url)}&rendered=true`,
          { timeout: scraperConfig.timeout, headers: { "User-Agent": USER_AGENTS[attempt % USER_AGENTS.length] } }
        )
        const html = response.data
        if (html && html.length > 100) {
          logger.info({ stage: "SCRAPERAPI_SUCCESS", url, textLength: extractText(html).length })
          return { url, title: extractTitle(html), raw_html: html, text_content: extractText(html), metadata: {}, success: true, source: "scraperapi" }
        }
      } catch (e) {
        logger.error({ stage: "SCRAPERAPI_ERROR", url, error: e instanceof Error ? e.message : String(e) })
      }
    }

    // Fallback to direct HTTP
    try {
      const response = await axios.get(url, {
        timeout: scraperConfig.timeout,
        headers: { "User-Agent": USER_AGENTS[attempt % USER_AGENTS.length], "Accept-Language": "en-US,en;q=0.9" },
      })
      const html = response.data
      if (html && html.length > 100) {
        logger.info({ stage: "DIRECT_SUCCESS", url, textLength: extractText(html).length })
        return { url, title: extractTitle(html), raw_html: html, text_content: extractText(html), metadata: {}, success: true, source: "direct" }
      }
    } catch (e) {
      logger.error({ stage: "DIRECT_ERROR", url, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { url, title: "", raw_html: "", text_content: "", metadata: {}, success: false, error: "All retries failed", source: "fallback" }
}

interface SearchResult {
  title: string
  link: string
  snippet: string
  extracted_text?: string
  position?: number
  date?: string
  subreddit?: string
  author?: string
  timestamp?: string
  source?: string
}

function normalizeUrl(url: string): string {
  if (!url) return url
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url
  }
  return url
}

interface QueryVariation {
  query: string
  intent: string
}

function simplifyQuery(originalQuery: string, signal?: string): QueryVariation[] {
  const variations: QueryVariation[] = []
  
  const templates: Record<string, string[]> = {
    pain: [
      "struggling with outbound sales",
      "can't generate leads",
      "outbound sales problems",
      "need help with pipeline",
      "cold email not working",
      "low reply rates outbound",
      "email open rates low",
      "lead gen challenges",
    ],
    hiring: [
      "hiring sales rep",
      "looking for account executive",
      "sales hiring b2b",
      "need sales representative",
      "hiring sales team",
    ],
    hiring_engineer: [
      "hiring senior engineer",
      "looking for developer",
      "software engineer needed",
      "engineering roles open",
      "dev hiring startup",
    ],
    hiring_sales: [
      "hiring sales manager",
      "account executive jobs",
      "sales development rep",
      "revenue jobs b2b",
    ],
    remote_hiring: [
      "remote jobs engineering",
      "remote work hiring",
      "distributed team hiring",
      "work from home jobs",
      "anywhere roles tech",
    ],
    tool_search: [
      "best outbound tools",
      "lead generation SaaS",
      "outbound software",
      "best sales tools",
      "email outreach platform",
    ],
    funding: [
      "seed funding b2b",
      "series a SaaS",
      "vc funding startup",
    ],
    launch: [
      "new product launch",
      "public beta launch",
      "announcing startup",
    ],
  }

  const templateSet = signal && templates[signal] ? templates[signal] : (templates.pain as string[])

  for (const v of templateSet!) {
    variations.push({ query: v, intent: signal || "pain" })
  }
  return variations
}

function classifyIntent(title: string, snippet: string): string {
  const text = (title + " " + snippet).toLowerCase()
  const painKeywords = ["struggling", "can't", "help", "frustrated", "problem", "fail", "stuck", "issue", "error", "broken", "need help", "how to", "why is", "doesn't work", "hard to", "failing"]
  const hiringKeywords = ["looking for", "hire", "need someone", "recruit", "job opening", "hiring", "vacancy", "position", "apply", "seeking", "remote"]
  const toolSearchKeywords = ["recommend", "best tool", "alternativ", "vs ", "comparison", "review", "tool", "software", "platform", "switching to", "migrating"]
  const fundingKeywords = ["raised", "funding", "series", "invested", "seed round", "venture capital", "backed", "investment"]
  const launchKeywords = ["launch", "released", "announced", "new product", "beta", "public launch", "debut"]
  const growthKeywords = ["scaling", "growing", "growth", "expanding", "hired", "team", "revenue", "hiring"]

  for (const kw of fundingKeywords) { if (text.includes(kw)) return "funding" }
  for (const kw of launchKeywords) { if (text.includes(kw)) return "launch" }
  for (const kw of growthKeywords) { if (text.includes(kw)) return "growth" }
  for (const kw of hiringKeywords) { if (text.includes(kw)) return "hiring" }
  for (const kw of toolSearchKeywords) { if (text.includes(kw)) return "tool_search" }
  for (const kw of painKeywords) { if (text.includes(kw)) return "pain" }
  return "discussion"
}

function calculateIntentScore(intentType: string): number {
  const weights: Record<string, number> = {
    hiring: 0.9,
    hiring_sales: 0.92,
    hiring_engineer: 0.92,
    remote_hiring: 0.88,
    funding: 0.88,
    funding_announcement: 0.9,
    launch: 0.75,
    product_launch: 0.78,
    pain: 0.85,
    tool_search: 0.65,
    discussion: 0.3,
    growth: 0.7,
    expansion: 0.72,
  }
  return weights[intentType] ?? 0.5
}

async function fetchRedditSearch(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const searchUrl = `https://old.reddit.com/search?q=${encodeURIComponent(query)}&sort=new`
  logger.info({ stage: "REDDIT_REQUEST", query })
  try {
    const result = await scrapeUrl(searchUrl)
    if (!result.success || !result.raw_html) {
      logger.error({ stage: "REDDIT_FAILED", query })
      return []
    }
    const $ = cheerio.load(result.raw_html)
    $("div.search-result").each((idx, el) => {
      const container = $(el)
      const title = container.find("a.search-title").text().trim() || container.find("a.title").text().trim()
      const link = container.find("a.search-title").attr("href") || container.find("a.title").attr("href")
      const subreddit = container.find("a.subreddit").text().trim() || container.find("span.domain").text().trim()
      const snippet = container.find("p.excerpt").text().trim() || container.find("div.md").text().trim().slice(0, 200)
      if (title && link) {
        results.push({ title: title.slice(0, 200), link: normalizeUrl(link), snippet: snippet.slice(0, 300), subreddit: subreddit || "unknown", position: idx + 1, source: "reddit" })
      }
    })
    logger.info({ stage: "REDDIT_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "REDDIT_ERROR", query, error: error instanceof Error ? error.message : String(error) })
  }
  return results
}

async function fetchHackerNewsSearch(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const searchUrl = `https://hn.algolia.com/?q=${encodeURIComponent(query)}&sort=new&tags=story`
  logger.info({ stage: "HN_REQUEST", query })
  try {
    const result = await scrapeUrl(searchUrl)
    if (!result.success || !result.raw_html) {
      logger.error({ stage: "HN_FAILED", query })
      return []
    }
    const $ = cheerio.load(result.raw_html)
    $("tr.athing, div.story, article.story").each((idx, el) => {
      const container = $(el)
      const title = container.find("a.story__title, a.titlelink, span.title a").first().text().trim() || container.find("a").first().text().trim()
      const link = container.find("a.story__title, a.titlelink").attr("href")
      const url = container.find("span.sitebit a, span.url").text().trim()
      const author = container.find("a.hnuser, span.author").text().trim()
      const points = container.find("span.score, span.rank").text().trim()
      if (title && title.length > 3) {
        results.push({ title: title.slice(0, 200), link: normalizeUrl(link || url || ""), snippet: `Points: ${points || 0} | by ${author || "unknown"}`.slice(0, 200), author: author || "anonymous", position: idx + 1, source: "hn" })
      }
    })
    logger.info({ stage: "HN_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "HN_ERROR", query, error: error instanceof Error ? error.message : String(error) })
  }
  return results
}

async function fetchIndieHackersSearch(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const searchUrl = `https://www.indiehackers.com/search?q=${encodeURIComponent(query)}`
  logger.info({ stage: "INDIE_HACKERS_REQUEST", query })
  try {
    const result = await scrapeUrl(searchUrl)
    if (!result.success || !result.raw_html) {
      logger.error({ stage: "INDIE_HACKERS_FAILED", query })
      return []
    }
    const $ = cheerio.load(result.raw_html)
    $("div.post, article.post, li.post-list-item").each((idx, el) => {
      const container = $(el)
      const title = container.find("h3, h2, .post-title, a.title").first().text().trim() || container.find("a").first().text().trim()
      const link = container.find("a.title, a.post-link").first().attr("href")
      const author = container.find("span.author, a[href*='/u/']").first().text().trim()
      const snippet = container.find("p.excerpt, .content").first().text().trim().slice(0, 200)
      if (title && title.length > 3) {
        results.push({ title: title.slice(0, 200), link: normalizeUrl(link || ""), snippet: snippet.slice(0, 300), author: author || "anonymous", position: idx + 1, source: "indiehackers" })
      }
    })
    logger.info({ stage: "INDIE_HACKERS_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "INDIE_HACKERS_ERROR", query, error: error instanceof Error ? error.message : String(error) })
  }
  return results
}

async function fetchProductHuntSearch(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const searchUrl = `https://www.producthunt.com/search?q=${encodeURIComponent(query)}`
  logger.info({ stage: "PRODUCT_HUNT_REQUEST", query })
  try {
    const result = await scrapeUrl(searchUrl)
    if (!result.success || !result.raw_html) {
      logger.error({ stage: "PRODUCT_HUNT_FAILED", query })
      return []
    }
    const $ = cheerio.load(result.raw_html)
    $("div.product, article.product, li[data-hook*=product]").each((idx, el) => {
      const container = $(el)
      const title = container.find("h3, h2, .product-name").first().text().trim() || container.find("a[href*='/products/']").first().text().trim()
      const link = container.find("a[href*='/products/']").first().attr("href")
      const tagline = container.find("p.tagline, .tagline, .description").first().text().trim()
      const votes = container.find("span.votes, button").first().text().trim()
      if (title && title.length > 2) {
        results.push({ title: title.slice(0, 200), link: normalizeUrl(link || ""), snippet: (tagline || "").slice(0, 300) + (votes ? ` | ${votes} votes` : ""), position: idx + 1, source: "producthunt" })
      }
    })
    logger.info({ stage: "PRODUCT_HUNT_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "PRODUCT_HUNT_ERROR", query, error: error instanceof Error ? error.message : String(error) })
  }
  return results
}

function getMockSearchResultsIfAllowed(query: string): SearchResult[] | null {
  if (process.env.ALLOW_MOCK !== "true") {
    logger.warn({ stage: "FALLBACK_BLOCKED", reason: "ALLOW_MOCK not set" })
    return null
  }
  return [{ title: "Sales Automation Platform", link: "https://example-sales.com", snippet: "Leading sales automation for B2B" }]
}

export class SearchAdapter extends DiscoveryAdapter {
  source = "community_search"
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
    SignalType.ADVERTISING,
    SignalType.PARTNERSHIP,
    SignalType.ACQUISITION,
  ]
  private brandId: string | null = null

  constructor(config: AdapterConfig = {}, brandId?: string) {
    super(config)
    this.brandId = brandId || null
    initScraper({ apifyApiKey: config.apifyApiKey, scraperApiKey: config.scraperApiKey, timeout: 20000, retries: 3 })
  }

  override supports(signal: SignalType): boolean {
    return true
  }

  async fetch(params: AdapterParams): Promise<FetchResult> {
    const results = await this.executeSearch(params.query, params.signal)
    return { raw: results, metadata: { searchQuery: params.query, resultCount: results.length, brandId: this.brandId, source: results.length > 0 ? "community_search" : "none" } }
  }

  protected async executeSearch(query: string, signal: string): Promise<SearchResult[]> {
    logger.info({ stage: "ADAPTER_EXECUTION", adapter: "community_search", query, signal })
    const allResults: SearchResult[] = []
    const intentCounts = { pain: 0, hiring: 0, tool_search: 0, discussion: 0, funding: 0, launch: 0, growth: 0 }
    const queryVariations = simplifyQuery(query, signal)

    logger.info({ stage: "QUERY_VARIATIONS", count: queryVariations.length, signal })

    for (let i = 0; i < queryVariations.length; i++) {
      const variation = queryVariations[i]

      // YC/Hacker News
      const hnResults = await fetchHackerNewsSearch(variation.query)
      if (hnResults.length > 0) {
        allResults.push(...hnResults)
        for (const r of hnResults) { intentCounts[classifyIntent(r.title, r.snippet) as keyof typeof intentCounts]++ }
        logger.info({ stage: "HN_RESULTS", query: variation.query, count: hnResults.length })
      }

      // Indie Hackers
      const ihResults = await fetchIndieHackersSearch(variation.query)
      if (ihResults.length > 0) {
        allResults.push(...ihResults)
        for (const r of ihResults) { intentCounts[classifyIntent(r.title, r.snippet) as keyof typeof intentCounts]++ }
        logger.info({ stage: "INDIE_HACKERS_RESULTS", query: variation.query, count: ihResults.length })
      }

      // Product Hunt
      const phResults = await fetchProductHuntSearch(variation.query)
      if (phResults.length > 0) {
        allResults.push(...phResults)
        for (const r of phResults) { intentCounts[classifyIntent(r.title, r.snippet) as keyof typeof intentCounts]++ }
        logger.info({ stage: "PRODUCT_HUNT_RESULTS", query: variation.query, count: phResults.length })
      }

      // Reddit (fallback if few results)
      if (allResults.length < 5) {
        const redditResults = await fetchRedditSearch(variation.query)
        if (redditResults.length > 0) {
          allResults.push(...redditResults)
          for (const r of redditResults) { intentCounts[classifyIntent(r.title, r.snippet) as keyof typeof intentCounts]++ }
          logger.info({ stage: "REDDIT_RESULTS", query: variation.query, count: redditResults.length })
        }
      }

      // Rate limiting
      if (i < queryVariations.length - 1 && allResults.length < 10) {
        const delay = 2000 + Math.random() * 1000
        await setTimeout(delay)
      }
    }

    if (allResults.length > 0) {
      logger.info({ stage: "SEARCH_SUCCESS", totalResults: allResults.length, intentCounts })
      return allResults.slice(0, 50)
    }

    const mockResults = getMockSearchResultsIfAllowed(query)
    if (mockResults) return mockResults

    logger.error({ stage: "NO_RESULTS", query })
    return []
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as SearchResult[]
    logger.info({ stage: "NORMALIZE_START", count: items.length })
    return items.filter(item => item.title || item.link).map(item => {
      const intentType = classifyIntent(item.title, item.snippet)
      const score = calculateIntentScore(intentType)
      const domain = this.extractDomainFromUrl(item.link)
      return this.createOpportunity({
        name: this.extractCompanyName(item.title, domain),
        domain,
        source: item.source || this.source,
        signal: this.mapIntentToSignal(intentType),
        sub_signal: intentType,
        confidence: Math.round(score * 100),
        metadata: { title: item.title, snippet: item.snippet, url: item.link, extracted_text: item.extracted_text, subreddit: item.subreddit, author: item.author, intent_type: intentType },
      })
    })
  }

  private mapIntentToSignal(intentType: string): string {
    switch (intentType) {
      case "pain": return SignalType.PAIN
      case "hiring": return SignalType.HIRING
      case "tool_search": return SignalType.TECH_USAGE
      default: return SignalType.PAIN
    }
  }

  private extractCompanyName(title: string, domain?: string): string {
    if (domain) return domain.replace(/^www\./, "").replace(/\..*/, "")
    return title.replace(/[-|–]\s*.*$/, "").trim() || "Unknown"
  }

  private extractDomainFromUrl(url: string): string {
    if (!url) return ""
    try { return new URL(url).hostname.replace(/^www\./, "") } catch { return "" }
  }
}

declare module "../adapter" {
  interface AdapterConfig {
    apifyApiKey?: string
    scraperApiKey?: string
  }
}