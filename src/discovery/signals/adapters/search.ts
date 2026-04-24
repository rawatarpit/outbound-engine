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

// Debug mode - set to "true" to save raw HTML
const DEBUG_MODE = process.env.SCRAPER_DEBUG === "true"

interface SearchResult {
  title: string
  link: string
  snippet: string
  extracted_text?: string
  position?: number
  date?: string
}

// =========================================================
// URL Normalization
// =========================================================

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
  } catch {
    // Invalid URL
  }
  return [...new Set(variants)]
}

// =========================================================
// ROBUST SCRAPING EXECUTOR - NO SILENT FALLBACK
// =========================================================

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

      // Try stealthy-fetch
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

          // DETECT BLOCKED/BOT RESPONSES
          if (!content || content.length < 1000) {
            logger.error({ stage: "SCRAPER_EMPTY_RESPONSE", url: variant, length: content?.length })
            continue
          }

          if (content.includes("captcha") || content.includes("unusual traffic") || content.includes("Robot Check")) {
            logger.error({ stage: "BOT_DETECTED", url: variant, preview: content.slice(0, 200) })
            continue
          }

          // DEBUG MODE: save raw HTML
          if (DEBUG_MODE) {
            const debugFile = `/tmp/scraper-debug-${Date.now()}.html`
            writeFileSync(debugFile, content)
            logger.info({ stage: "DEBUG_SAVED", file: debugFile })
          }

          logger.info({ 
            stage: "SCRAPER_SUCCESS", 
            url: variant, 
            htmlLength: content.length,
            preview: content.slice(0, 300)
          })

          return { success: true, content }
        }
      } catch (error) {
        logger.error({ 
          stage: "SCRAPER_ERROR", 
          url: variant, 
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        })
      }

      // Fallback to regular fetch
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

          if (!content || content.length < 1000) {
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

      // Clean up
      if (existsSync(tempFile)) {
        try { unlinkSync(tempFile) } catch {}
      }

      // Add delay between attempts
      if (attempt < maxAttempts - 1) {
        const delay = 2000 + Math.random() * 1000
        logger.info({ stage: "SCRAPER_DELAY", delayMs: delay })
        await setTimeout(delay)
      }
    }
  }

  // NO SILENT FALLBACK - throw error
  const errorMsg = "All scraper attempts failed"
  logger.error({ stage: "SCRAPER_EXHAUSTED", url, message: errorMsg })
  return { success: false, content: "", error: errorMsg }
}

// =========================================================
// Extract text from HTML
// =========================================================

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
// Zenserp API
// =========================================================

async function fetchWithZenserp(query: string, apiKey: string, maxResults: number = 20): Promise<SearchResult[]> {
  logger.info({ stage: "ZENSERP_REQUEST", query })

  try {
    const response = await axios.get("https://api.zenserp.com/search", {
      params: { q: query, tbm: "nws", size: maxResults },
      headers: { "X-API-Key": apiKey },
      timeout: 10000,
    })

    const results = response.data?.organic ?? response.data?.results ?? []
    logger.info({ stage: "ZENSERP_RESPONSE", count: results.length })
    
    return results.map((item: any, idx: number) => ({
      title: item.title ?? "",
      link: item.url ?? item.link ?? "",
      snippet: item.description ?? item.snippet ?? "",
      position: idx + 1,
    }))
  } catch (error) {
    logger.error({ stage: "ZENSERP_ERROR", error: error.message })
    return []
  }
}

// =========================================================
// Mock data - ONLY if explicitly allowed
// =========================================================

function getMockSearchResultsIfAllowed(query: string): SearchResult[] | null {
  // Only allow mock fallback if explicitly enabled
  if (process.env.ALLOW_MOCK !== "true") {
    logger.warn({ stage: "FALLBACK_BLOCKED", reason: "ALLOW_MOCK not set to true" })
    return null
  }
  
  logger.warn({ stage: "FALLBACK_TRIGGERED", reason: "All scrapers failed", using: "mock_data" })
  return [
    { title: "Sales Automation Platform", link: "https://example-sales.com", snippet: "Leading sales automation for B2B" },
    { title: "Outbound Lead Generation", link: "https://example-leads.com", snippet: "Generate qualified leads" },
    { title: "AI Sales Assistant", link: "https://example-ai.com", snippet: "Personalized outreach with AI" },
  ]
}

// =========================================================
// SearchAdapter - NO SILENT FALLBACKS
// =========================================================

export class SearchAdapter extends DiscoveryAdapter {
  source = "google_search"
  supportedSignals = [
    SignalType.HIRING, SignalType.PAIN, SignalType.GROWTH_ACTIVITY,
    SignalType.TECH_USAGE, SignalType.FUNDING, SignalType.LAUNCH,
    SignalType.ADVERTISING, SignalType.PARTNERSHIP,
  ]

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
        source: results.length > 0 ? "scrapling" : "none",
      },
    }
  }

  protected async executeSearch(query: string, signal: string): Promise<SearchResult[]> {
    logger.info({ stage: "EXECUTE_SEARCH_START", query, signal })

    let searchResults: SearchResult[] = []

    // Step 1: Try Zenserp if API key configured
    const zenserpKey = this.config.zenserpApiKey
    if (zenserpKey) {
      searchResults = await fetchWithZenserp(query, zenserpKey)
      if (searchResults.length > 0) {
        logger.info({ stage: "ZENSERP_SUCCESS", count: searchResults.length })
      }
    }

    // Step 2: Try built-in scraper to get URLs
    if (searchResults.length === 0) {
      logger.info({ stage: "BUILTIN_SCRAPER_START" })
      searchResults = await this.executeBuiltInSearch(query)
      if (searchResults.length > 0) {
        logger.info({ stage: "BUILTIN_SCRAPER_SUCCESS", count: searchResults.length })
      }
    }

    // Step 3: Use Scrapling to enhance URLs
    if (searchResults.length > 0) {
      const urls = searchResults.filter(r => r.link && r.link.startsWith("http")).map(r => r.link)
      
      if (urls.length > 0) {
        logger.info({ stage: "SCRAPING_URLS", count: urls.length })
        
        const scrapedResults = await this.scrapeUrls(urls)
        
        if (scrapedResults.length > 0) {
          logger.info({ stage: "SCRAPING_SUCCESS", count: scrapedResults.length })
          return scrapedResults
        } else {
          logger.warn({ stage: "SCRAPING_FAILED", message: "Using original search results" })
          // Return original search results if Scrapling failed
          return searchResults
        }
      }
    }

    // Step 4: Built-in scraper returned 0 results (likely blocked by Google)
    // Try Scrapling directly on common domains
    if (searchResults.length === 0) {
      logger.warn({ stage: "BUILTIN_BLOCKED", message: "Trying direct Scrapling" })
      
      // Extract potential domains from query
      const keywords = query.split(/[\s,]+/).filter(w => w.length > 3 && !w.includes("http")).slice(0, 5)
      const directUrls: string[] = []
      
      for (let i = 0; i < keywords.length; i++) {
        const k = keywords[i]
        // Try common SaaS pattern
        if (!k.includes(".") && !k.includes(":")) {
          directUrls.push("https://" + k.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com")
        }
      }
      
      if (directUrls.length > 0) {
        logger.info({ stage: "SCRAPING_DIRECT", urls: directUrls.length })
        const scrapedResults = await this.scrapeUrls(directUrls)
        if (scrapedResults.length > 0) {
          logger.info({ stage: "SCRAPING_DIRECT_SUCCESS", count: scrapedResults.length })
          return scrapedResults
        }
      }
    }

    // Step 5: If we have any search results, return them
    if (searchResults.length > 0) {
      return searchResults
    }

    // Step 6: Allow mock only if explicitly enabled
    const mockResults = getMockSearchResultsIfAllowed(query)
    if (mockResults) {
      return mockResults
    }

    // Return empty - don't fail silently
    logger.error({ stage: "NO_RESULTS", query })
    return []
  }

  private async scrapeUrls(urls: string[]): Promise<SearchResult[]> {
    const results: SearchResult[] = []
    const maxConcurrent = 3

    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const batch = urls.slice(i, i + maxConcurrent)
      
      const promises = batch.map(async (url: string, idx: number) => {
        const result = await runScrapling(url, 2)
        
        if (result.success && result.content) {
          const title = extractTitleFromHtml(result.content)
          const text = extractTextFromHtml(result.content)
          
          return {
            title,
            link: url,
            snippet: text.slice(0, 200),
            extracted_text: text,
            position: i + idx + 1,
          }
        } else {
          // Log failure but don't fallback silently
          logger.error({ stage: "SCRAPE_URL_FAILED", url, error: result.error })
          return null
        }
      })

      const batchResults = await Promise.all(promises)
      const validResults = batchResults.filter(Boolean)
      results.push(...validResults)
    }

    logger.info({ stage: "SCRAPING_COMPLETE", extractedCount: results.length })
    return results
  }

  private async executeBuiltInSearch(query: string): Promise<SearchResult[]> {
    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws`
      
      const response = await axios.get(searchUrl, {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      })

      const $ = cheerio.load(response.data)
      const results: SearchResult[] = []

      const selectors = ["div.Snrnice", "div.g", "div.llcl", "div.NiLAwe"]
      
      for (const sel of selectors) {
        $(sel).each((_, el) => {
          const container = $(el)
          const title = container.find("h3, div.MBeuO, div.yfBeLX").first().text().trim()
          const link = container.find("a").attr("href") || ""
          const snippet = container.find("div.GIRe9, div.yfAn51, span.aCGNS").first().text().trim()

          if (title && link) {
            results.push({
              title,
              link: link.startsWith("/url?") ? this.extractUrlFromRedirect(link) : link,
              snippet: snippet.slice(0, 200),
              position: results.length + 1,
            })
          }
        })
        
        if (results.length > 0) break
      }

      return results.slice(0, 20)
    } catch (error) {
      logger.error({ stage: "BUILTIN_SCRAPER_ERROR", error: error.message })
      return []
    }
  }

  private extractUrlFromRedirect(url: string): string {
    try {
      const urlObj = new URL(url)
      return urlObj.searchParams.get("q") || url
    } catch {
      return url
    }
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as SearchResult[]

    logger.info({ stage: "NORMALIZE_START", count: items.length })

    return items
      .filter(item => item.title || item.link)
      .map(item => {
        const domain = this.extractDomain(item.link)
        const signal = this.inferSignal(item.title, item.snippet)

        return this.createOpportunity({
          name: this.extractCompanyName(item.title, domain),
          domain,
          source: this.source,
          signal,
          sub_signal: this.extractSubSignal(item.snippet),
          confidence: this.calculateConfidence(item),
          metadata: {
            title: item.title,
            snippet: item.snippet,
            url: item.link,
            extracted_text: item.extracted_text,
          },
        })
      })
  }

  private extractCompanyName(title: string, domain?: string): string {
    if (domain) return domain.replace(/^www\./, "").replace(/\..*/, "")
    return title.replace(/[-|–]\s*.*$/, "").trim() || "Unknown"
  }

  private inferSignal(title: string, snippet: string): string {
    const text = (title + " " + snippet).toLowerCase()
    if (text.includes("hiring") || text.includes("job")) return SignalType.HIRING
    if (text.includes("funding") || text.includes("raised")) return SignalType.FUNDING
    if (text.includes("launch") || text.includes("released")) return SignalType.LAUNCH
    if (text.includes("pain") || text.includes("problem") || text.includes("struggle")) return SignalType.PAIN
    if (text.includes("growth") || text.includes("scale")) return SignalType.GROWTH_ACTIVITY
    if (text.includes("partner")) return SignalType.PARTNERSHIP
    return SignalType.PAIN
  }

  private extractSubSignal(snippet: string): string | undefined {
    const lower = snippet.toLowerCase()
    if (lower.includes("cold call")) return "cold_calling"
    if (lower.includes("email")) return "email_outreach"
    if (lower.includes("lead gen")) return "lead_generation"
    if (lower.includes("sales")) return "sales"
    if (lower.includes("marketing")) return "marketing"
    return undefined
  }

  private calculateConfidence(item: SearchResult): number {
    let confidence = 0.5
    const text = (item.title + " " + item.snippet).toLowerCase()
    if (item.date && (item.date.includes("2026") || item.date.includes("2025"))) confidence += 0.15
    const urgency = ["need", "looking for", "want", "trying to", "best", "recommend"]
    if (urgency.some(p => text.includes(p))) confidence += 0.15
    if (text.includes("vs ") || text.includes("alternativ")) confidence += 0.1
    return Math.min(1, confidence)
  }
}

declare module "../adapter" {
  interface AdapterConfig {
    zenserpApiKey?: string
  }
}