import { execSync } from "child_process"
import { readFileSync, unlinkSync, existsSync, writeFileSync } from "fs"
import { setTimeout } from "timers/promises"
import axios from "axios"
import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"
import * as cheerio from "cheerio"
import pino from "pino"

const logger = pino({ level: "info" })

const DEBUG_MODE = process.env.SCRAPER_DEBUG === "true"

interface RedditPost {
  title: string
  url: string
  subreddit: string
  author: string
  timestamp: string
  snippet: string
  score?: number
  comments?: number
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
}

interface OpportunityResult {
  source: string
  query: string
  title: string
  url: string
  snippet: string
  intent_type: string
  score: number
  subreddit?: string
  author?: string
}

function normalizeUrl(url: string): string {
  if (!url) return url
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url
  }
  return url
}

function getUrlVariants(url: string): string[] {
  const variants: string[] = [url]
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname
    if (hostname.startsWith("www.")) {
      variants.push("https://" + hostname.slice(4))
    } else {
      variants.push("https://www." + hostname)
    }
  } catch {}
  return [...new Set(variants)]
}

interface ScrapingResult {
  content: string
  success: boolean
  error?: string
}

async function runScrapling(url: string, maxAttempts: number = 2): Promise<ScrapingResult> {
  const tempFile = "/tmp/scrapling_output.html"
  
  logger.info({ stage: "SCRAPER_REQUEST", url, maxAttempts })

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const urlVariants = getUrlVariants(url)
    
    for (const variant of urlVariants) {
      logger.info({ stage: "SCRAPER_ATTEMPT", variant, attempt: attempt + 1 })

      try {
        const command = [
          "scrapling",
          "extract",
          "stealthy-fetch",
          `"${variant}"`,
          tempFile,
        ].join(" ")

        const html = execSync(command, {
          encoding: "utf-8",
          timeout: 20000,
          maxBuffer: 10 * 1024 * 1024,
        })

        if (existsSync(tempFile)) {
          const content = readFileSync(tempFile, "utf-8")
          try { unlinkSync(tempFile) } catch {}

          if (!content || content.length < 500) {
            logger.error({ stage: "SCRAPER_EMPTY_RESPONSE", url: variant, length: content?.length })
            continue
          }

          if (content.includes("captcha") || content.includes("unusual traffic") || content.includes("Robot Check")) {
            logger.error({ stage: "BOT_DETECTED", url: variant })
            continue
          }

          if (DEBUG_MODE) {
            const debugFile = `/tmp/scraper-debug-${Date.now()}.html`
            writeFileSync(debugFile, content)
            logger.info({ stage: "DEBUG_SAVED", file: debugFile })
          }

          logger.info({ stage: "SCRAPER_SUCCESS", url: variant, htmlLength: content.length })
          return { success: true, content }
        }
      } catch (error) {
        logger.error({ stage: "SCRAPER_ERROR", url: variant, error: error instanceof Error ? error.message : String(error) })
      }

      try {
        const command = [
          "scrapling",
          "extract",
          "fetch",
          `"${variant}"`,
          tempFile,
        ].join(" ")

        execSync(command, {
          encoding: "utf-8",
          timeout: 20000,
          maxBuffer: 10 * 1024 * 1024,
        })

        if (existsSync(tempFile)) {
          const content = readFileSync(tempFile, "utf-8")
          try { unlinkSync(tempFile) } catch {}

          if (!content || content.length < 500) {
            logger.error({ stage: "SCRAPER_EMPTY_RESPONSE", url: variant })
            continue
          }

          if (DEBUG_MODE) {
            const debugFile = `/tmp/scraper-debug-${Date.now()}.html`
            writeFileSync(debugFile, content)
          }

          logger.info({ stage: "SCRAPER_SUCCESS_FALLBACK", url: variant, htmlLength: content.length })
          return { success: true, content }
        }
      } catch (error) {
        logger.error({ stage: "SCRAPER_FALLBACK_ERROR", url: variant, error: error.message })
      }

      if (existsSync(tempFile)) {
        try { unlinkSync(tempFile) } catch {}
      }

      if (attempt < maxAttempts - 1) {
        const delay = 2000 + Math.random() * 1000
        logger.info({ stage: "SCRAPER_DELAY", delayMs: delay })
        await setTimeout(delay)
      }
    }
  }

  const errorMsg = "All scraper attempts failed"
  logger.error({ stage: "SCRAPER_EXHAUSTED", url, message: errorMsg })
  return { success: false, content: "", error: errorMsg }
}

function extractTextFromHtml(html: string, maxLength: number = 500): string {
  if (!html) return ""
  
  try {
    const $ = cheerio.load(html)
    $("script, style, nav, footer, header, aside").remove()
    
    const text = $("main, article, .content, .hero, .main, body")
      .first()
      .text()
      .slice(0, maxLength)
    
    return text.trim() || $("body").text().slice(0, maxLength).trim()
  } catch {
    return ""
  }
}

function extractTitleFromHtml(html: string): string {
  if (!html) return "Unknown"
  try {
    const $ = cheerio.load(html)
    return $("h1").first().text().trim() || $("title").text().trim() || "Unknown"
  } catch {
    return "Unknown"
  }
}

// =========================================================
// QUERY SIMPLIFICATION - Convert complex queries to short variations
// =========================================================

interface QueryVariation {
  query: string
  intent: string
}

function simplifyQuery(originalQuery: string): QueryVariation[] {
  const variations: QueryVariation[] = []
  const lower = originalQuery.toLowerCase()
  
  // Determine primary intent
  let primaryIntent = "tool_search"
  if (lower.includes("hire") || lower.includes("recruit") || lower.includes("sales rep") || lower.includes("bd")) {
    primaryIntent = "hiring"
  } else if (lower.includes("problem") || lower.includes("struggle") || lower.includes("can't") || lower.includes("fail")) {
    primaryIntent = "pain"
  } else if (lower.includes("automate") || lower.includes("tool") || lower.includes("software")) {
    primaryIntent = "tool_search"
  }
  
  // Extract core topic keywords
  const stopWords = ["hiring", "sales", "representative", "b2b", "founder", "startup", "looking", "for", "need", "help", "with", "the", "best"]
  const words = originalQuery.split(/[\s,]+/)
    .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(w => w.length > 2 && !stopWords.includes(w))
  
  const coreTopic = words[0] || originalQuery.split(" ")[0]?.toLowerCase() || ""
  
  // Generate variations
  const variationTemplates = [
    { template: coreTopic, intent: primaryIntent },
    { template: coreTopic + " problems", intent: "pain" },
    { template: coreTopic + " struggling", intent: "pain" },
    { template: coreTopic + " help needed", intent: "pain" },
    { template: "hiring " + coreTopic + " expert", intent: "hiring" },
    { template: coreTopic + " alternatives", intent: "tool_search" },
    { template: "best " + coreTopic + " software", intent: "tool_search" },
    { template: coreTopic + " review", intent: "tool_search" },
  ]
  
  for (const v of variationTemplates) {
    if (v.template && v.template.length > 2) {
      variations.push({ query: v.template, intent: v.intent })
    }
  }
  
  // Dedupe and limit
  const uniqueQueries = [...new Set(variations.map(v => v.query))].slice(0, 10)
  return uniqueQueries.map(q => ({
    query: q,
    intent: variations.find(v => v.query === q)?.intent || primaryIntent,
  }))
}

// =========================================================
// INTENT CLASSIFICATION
// =========================================================

function classifyIntent(title: string, snippet: string): string {
  const text = (title + " " + snippet).toLowerCase()
  
  const painKeywords = ["struggling", "can't", "help", "frustrated", "problem", "fail", "stuck", "issue", "error", "broken", "need help", "how to", "why is", "doesn't work"]
  const hiringKeywords = ["looking for", "hire", "need someone", "recruit", "job opening", "hiring", "vacancy", "position", "candidate"]
  const toolSearchKeywords = ["recommend", "best tool", "alternativ", "vs ", "comparison", "review", "tool", "software", "platform"]
  
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

function calculateIntentScore(intentType: string): number {
  switch (intentType) {
    case "pain": return 0.85
    case "hiring": return 0.8
    case "tool_search": return 0.6
    case "discussion": return 0.3
    default: return 0.5
  }
}

// =========================================================
// REDDIT SEARCH
// =========================================================

async function fetchRedditSearch(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const encodedQuery = encodeURIComponent(query)
  
  // Try old.reddit.com search
  const searchUrl = `https://old.reddit.com/search?q=${encodedQuery}&sort=new`
  
  logger.info({ stage: "REDDIT_REQUEST", query, url: searchUrl })

  try {
    const result = await runScrapling(searchUrl, 2)
    
    if (!result.success || !result.content) {
      logger.error({ stage: "REDDIT_FAILED", query, error: result.error })
      return []
    }

    const $ = cheerio.load(result.content)
    
    // Parse Reddit search results - old.reddit format
    $("div.search-result").each((idx, el) => {
      const container = $(el)
      const title = container.find("a.search-title").text().trim() || container.find("a.title").text().trim()
      const link = container.find("a.search-title").attr("href") || container.find("a.title").attr("href")
      const subreddit = container.find("a.subreddit").text().trim() || container.find("span.domain").text().trim()
      const author = container.find("a.author").text().trim()
      const timestamp = container.find("time").attr("datetime") || ""
      const snippet = container.find("p.excerpt").text().trim() || container.find("div.md").text().trim().slice(0, 200)
      
      if (title && link) {
        results.push({
          title: title.slice(0, 200),
          link: normalizeUrl(link),
          snippet: snippet.slice(0, 300),
          subreddit: subreddit || "unknown",
          author: author || "anonymous",
          timestamp,
          position: idx + 1,
        })
      }
    })

    // Fallback: try generic parsing if above fails
    if (results.length === 0) {
      $("a[href*='/r/']").each((idx, el) => {
        const link = $(el).attr("href")
        const title = $(el).text().trim()
        
        if (link && title && link.includes("/comments/")) {
          results.push({
            title: title.slice(0, 200),
            link: normalizeUrl(link),
            snippet: "",
            subreddit: link.split("/r/")[1]?.split("/")[0] || "unknown",
            author: "",
            timestamp: "",
            position: idx + 1,
          })
        }
      })
    }

    logger.info({ stage: "REDDIT_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "REDDIT_ERROR", query, error: error instanceof Error ? error.message : String(error) })
  }

  return results
}

// =========================================================
// HACKER NEWS SEARCH
// =========================================================

async function fetchHackerNewsSearch(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const encodedQuery = encodeURIComponent(query)
  
  const searchUrl = `https://hn.algolia.com/?q=${encodedQuery}&sort=new&tags=story`
  
  logger.info({ stage: "HN_REQUEST", query, url: searchUrl })

  try {
    const result = await runScrapling(searchUrl, 2)
    
    if (!result.success || !result.content) {
      logger.error({ stage: "HN_FAILED", query, error: result.error })
      return []
    }

    const $ = cheerio.load(result.content)
    
    $("div.story, div.item, article").each((idx, el) => {
      const container = $(el)
      const title = container.find("a.story__title, a.title, span.title").text().trim()
      const link = container.find("a.story__title, a.title").attr("href")
      const url = container.find("a.story__url, span.url a, a.url").text().trim()
      const author = container.find("span.author, a.author").text().trim()
      const timestamp = container.find("span.date, time").text().trim()
      const points = container.find("span.counter, span.points").text().trim()
      
      if (title) {
        results.push({
          title: title.slice(0, 200),
          link: normalizeUrl(link || url || ""),
          snippet: `Points: ${points || 0} | by ${author || "unknown"} | ${timestamp || ""}`.slice(0, 200),
          author: author || "anonymous",
          timestamp,
          position: idx + 1,
        })
      }
    })

    logger.info({ stage: "HN_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "HN_ERROR", query, error: error instanceof Error ? error.message : String(error) })
  }

  return results
}

// =========================================================
// INDIE HACKERS SEARCH
// =========================================================

async function fetchIndieHackersSearch(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const encodedQuery = encodeURIComponent(query)
  
  const searchUrl = `https://www.indiehackers.com/search?q=${encodedQuery}`
  
  logger.info({ stage: "INDIE_HACKERS_REQUEST", query, url: searchUrl })

  try {
    const result = await runScrapling(searchUrl, 2)
    
    if (!result.success || !result.content) {
      logger.error({ stage: "INDIE_HACKERS_FAILED", query, error: result.error })
      return []
    }

    const $ = cheerio.load(result.content)
    
    $("div.post, article.post, div.hacker-story, div.post-card").each((idx, el) => {
      const container = $(el)
      const title = container.find("h3, h2, .post-title, .title").first().text().trim()
      const link = container.find("a.title, a.post-link, h3 a, h2 a").first().attr("href")
      const author = container.find("span.author, .user-name, by").first().text().trim()
      const snippet = container.find("p.excerpt, .content, .post-body").first().text().trim().slice(0, 200)
      const timestamp = container.find("time, .date, .timestamp").first().text().trim()
      
      if (title) {
        results.push({
          title: title.slice(0, 200),
          link: normalizeUrl(link || ""),
          snippet: snippet.slice(0, 300),
          author: author || "anonymous",
          timestamp,
          position: idx + 1,
        })
      }
    })

    if (results.length === 0) {
      $("a[href*='/post/']").each((idx, el) => {
        const link = $(el).attr("href")
        const title = $(el).text().trim()
        
        if (link && title && link.length > 5) {
          results.push({
            title: title.slice(0, 200),
            link: normalizeUrl(link),
            snippet: "",
            timestamp: "",
            position: idx + 1,
          })
        }
      })
    }

    logger.info({ stage: "INDIE_HACKERS_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "INDIE_HACKERS_ERROR", query, error: error instanceof Error ? error.message : String(error) })
  }

  return results
}

// =========================================================
// PRODUCT HUNT SEARCH (NO API)
// =========================================================

async function fetchProductHuntSearch(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const encodedQuery = encodeURIComponent(query)
  
  const searchUrl = `https://www.producthunt.com/search?q=${encodedQuery}`
  
  logger.info({ stage: "PRODUCT_HUNT_REQUEST", query, url: searchUrl })

  try {
    const result = await runScrapling(searchUrl, 2)
    
    if (!result.success || !result.content) {
      logger.error({ stage: "PRODUCT_HUNT_FAILED", query, error: result.error })
      return []
    }

    const $ = cheerio.load(result.content)
    
    $("div.product, article.product, div.product-item, div.post-item").each((idx, el) => {
      const container = $(el)
      const title = container.find("h3, h2, .product-name, .title").first().text().trim()
      const link = container.find("a.product-link, a[href*='/products/']").first().attr("href")
      const tagline = container.find("p.tagline, .tagline, .description").first().text().trim()
      const votes = container.find("span.votes, .vote-count, [data-test*=votes]").first().text().trim()
      
      if (title) {
        results.push({
          title: title.slice(0, 200),
          link: normalizeUrl(link || ""),
          snippet: (tagline || "").slice(0, 300) + (votes ? ` | ${votes} votes` : ""),
          position: idx + 1,
        })
      }
    })

    if (results.length === 0) {
      $("a[href*='/products/']").each((idx, el) => {
        const link = $(el).attr("href")
        const title = $(el).text().trim()
        
        if (link && title && title.length > 2) {
          results.push({
            title: title.slice(0, 200),
            link: normalizeUrl(link),
            snippet: "",
            position: idx + 1,
          })
        }
      })
    }

    logger.info({ stage: "PRODUCT_HUNT_SUCCESS", query, count: results.length })
  } catch (error) {
    logger.error({ stage: "PRODUCT_HUNT_ERROR", query, error: error instanceof Error ? error.message : String(error) })
  }

  return results
}

// =========================================================
// MOCK DATA - ONLY IF EXPLICITLY ALLOWED
// =========================================================

function getMockSearchResultsIfAllowed(query: string): SearchResult[] | null {
  if (process.env.ALLOW_MOCK !== "true") {
    logger.warn({ stage: "FALLBACK_BLOCKED", reason: "ALLOW_MOCK not set to true" })
    return null
  }
  
  logger.warn({ stage: "FALLBACK_TRIGGERED", using: "mock_data" })
  return [
    { title: "Sales Automation Platform", link: "https://example-sales.com", snippet: "Leading sales automation for B2B" },
    { title: "Outbound Lead Generation", link: "https://example-leads.com", snippet: "Generate qualified leads" },
    { title: "AI Sales Assistant", link: "https://example-ai.com", snippet: "Personalized outreach with AI" },
  ]
}

// =========================================================
// SearchAdapter - REDDIT + HN PRIMARY SOURCES
// =========================================================

export class SearchAdapter extends DiscoveryAdapter {
  source = "community_search"
  supportedSignals = [
    SignalType.HIRING, SignalType.PAIN, SignalType.GROWTH_ACTIVITY,
    SignalType.TECH_USAGE, SignalType.FUNDING, SignalType.LAUNCH,
    SignalType.ADVERTISING, SignalType.PARTNERSHIP,
  ]

  override supports(signal: SignalType): boolean {
    return true // Scrapling searches all communities, signal type doesn't matter
  }

  private brandId: string | null = null

  constructor(config: AdapterConfig = {}, brandId?: string) {
    super(config)
    this.brandId = brandId || null
  }

  async fetch(params: AdapterParams): Promise<FetchResult> {
    const results = await this.executeSearch(params.query, params.signal)
    
    return {
      raw: results,
      metadata: {
        searchQuery: params.query,
        resultCount: results.length,
        brandId: this.brandId,
        source: results.length > 0 ? "reddit" : "none",
      },
    }
  }

  protected async executeSearch(query: string, signal: string): Promise<SearchResult[]> {
    logger.info({ stage: "ADAPTER_EXECUTION", adapter: "search", query, signal })
    logger.info({ stage: "EXECUTE_SEARCH_START", query, signal })

    const allResults: SearchResult[] = []
    const intentCounts = { pain: 0, hiring: 0, tool_search: 0, discussion: 0 }

    // Step 1: Generate simplified query variations
    const queryVariations = simplifyQuery(query)
    logger.info({ stage: "QUERY_VARIATIONS", count: queryVariations.length, variations: queryVariations.map(v => v.query) })

    // Step 2: Fetch from Reddit for each variation
    for (let i = 0; i < queryVariations.length; i++) {
      const variation = queryVariations[i]
      
      logger.info({ stage: "FETCH_REDDIT", query: variation.query, intent: variation.intent, index: i })
      
      const redditResults = await fetchRedditSearch(variation.query)
      
      // Add delay between requests
      if (i < queryVariations.length - 1) {
        const delay = 2000 + Math.random() * 1000
        logger.info({ stage: "REQUEST_DELAY", delayMs: delay })
        await setTimeout(delay)
      }

      if (redditResults.length > 0) {
        allResults.push(...redditResults)
        
        // Count intents
        for (const r of redditResults) {
          const intent = classifyIntent(r.title, r.snippet)
          intentCounts[intent as keyof typeof intentCounts]++
        }
        
        logger.info({ stage: "REDDIT_RESULTS", query: variation.query, count: redditResults.length })
      }
    }

    // Step 3: If not enough results, try Hacker News
    if (allResults.length < 10) {
      logger.info({ stage: "TRYING_HACKER_NEWS", query })
      
      const hnResults = await fetchHackerNewsSearch(query)
      
      if (hnResults.length > 0) {
        allResults.push(...hnResults)
        
        for (const r of hnResults) {
          const intent = classifyIntent(r.title, r.snippet)
          intentCounts[intent as keyof typeof intentCounts]++
        }
        
        logger.info({ stage: "HN_SUCCESS", count: hnResults.length })
      }
    }

    // Step 4: Try Indie Hackers
    if (allResults.length < 10) {
      logger.info({ stage: "TRYING_INDIE_HACKERS", query })
      
      const ihResults = await fetchIndieHackersSearch(query)
      
      if (ihResults.length > 0) {
        allResults.push(...ihResults)
        
        for (const r of ihResults) {
          const intent = classifyIntent(r.title, r.snippet)
          intentCounts[intent as keyof typeof intentCounts]++
        }
        
        logger.info({ stage: "INDIE_HACKERS_SUCCESS", count: ihResults.length })
      }
    }

    // Step 5: Try Product Hunt
    if (allResults.length < 10) {
      logger.info({ stage: "TRYING_PRODUCT_HUNT", query })
      
      const phResults = await fetchProductHuntSearch(query)
      
      if (phResults.length > 0) {
        allResults.push(...phResults)
        
        for (const r of phResults) {
          const intent = classifyIntent(r.title, r.snippet)
          intentCounts[intent as keyof typeof intentCounts]++
        }
        
        logger.info({ stage: "PRODUCT_HUNT_SUCCESS", count: phResults.length })
      }
    }

    // Step 6: If we have results, return them
    if (allResults.length > 0) {
      logger.info({ 
        stage: "SEARCH_SUCCESS", 
        totalResults: allResults.length,
        intentCounts,
        sources: ["reddit", "hn", "indiehackers", "producthunt"],
      })
      return allResults.slice(0, 50)
    }

    // Step 7: Allow mock only if explicitly enabled
    const mockResults = getMockSearchResultsIfAllowed(query)
    if (mockResults) {
      return mockResults
    }

    // NO SILENT FALLBACK - return empty
    logger.error({ stage: "NO_RESULTS", query, sources: "all" })
    return []
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as SearchResult[]

    logger.info({ stage: "NORMALIZE_START", count: items.length })

    return items
      .filter(item => item.title || item.link)
      .map(item => {
        const intentType = classifyIntent(item.title, item.snippet)
        const score = calculateIntentScore(intentType)
        const domain = this.extractDomainFromUrl(item.link)
        const signal = this.mapIntentToSignal(intentType)

        return this.createOpportunity({
          name: this.extractCompanyName(item.title, domain),
          domain,
          source: this.source,
          signal,
          sub_signal: intentType,
          confidence: Math.round(score * 100),
          metadata: {
            title: item.title,
            snippet: item.snippet,
            url: item.link,
            extracted_text: item.extracted_text,
            subreddit: item.subreddit,
            author: item.author,
            intent_type: intentType,
          },
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
    try {
      const parsed = new URL(url)
      return parsed.hostname.replace(/^www\./, "")
    } catch {
      return ""
    }
  }
}

declare module "../adapter" {
  interface AdapterConfig {
    zenserpApiKey?: string
  }
}