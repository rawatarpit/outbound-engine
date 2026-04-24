import { execSync } from "child_process"
import axios from "axios"
import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"
import * as cheerio from "cheerio"

interface SearchResult {
  title: string
  link: string
  snippet: string
  position?: number
  date?: string
}

export class SearchAdapter extends DiscoveryAdapter {
  source = "google_search"
  supportedSignals = Object.values(SignalType)

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
      },
    }
  }

  protected async executeSearch(
    query: string,
    signal: string,
  ): Promise<SearchResult[]> {
    // Try Python scrapling first (if installed)
    const scraplingResults = await this.executeScraplingSearch(query)
    if (scraplingResults.length > 0) {
      console.log(`[SearchAdapter] Scrapling found ${scraplingResults.length} results`)
      return scraplingResults
    }

    // Fallback to Zenserp if API key is configured
    const zenserpKey = this.config.zenserpApiKey
    if (zenserpKey) {
      console.log("[SearchAdapter] Falling back to Zenserp")
      return this.executeZenserpSearch(query, zenserpKey)
    }

    // Last fallback to built-in scraper
    const builtInResults = await this.executeBuiltInSearch(query)
    if (builtInResults.length > 0) {
      console.log(`[SearchAdapter] Built-in scraper found ${builtInResults.length} results`)
      return builtInResults
    }

    console.log("[SearchAdapter] No results from any source")
    return []
  }

  private async executeBuiltInSearch(query: string): Promise<SearchResult[]> {
    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws`
      
      const response = await axios.get(searchUrl, {
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      })

      const $ = cheerio.load(response.data)
      const results: SearchResult[] = []

      $("div.Snrnice").each((_, el) => {
        const container = $(el)
        const title = container.find("div.MBeuO").text().trim()
        const link = container.find("a").attr("href") || ""
        const snippet = container.find("div.GIRe9").text().trim()

        if (title && link) {
          results.push({
            title,
            link: link.startsWith("/url?") ? this.extractUrlFromRedirect(link) : link,
            snippet,
            position: results.length + 1,
          })
        }
      })

      if (results.length === 0) {
        $("div.g").each((_, el) => {
          const container = $(el)
          const title = container.find("h3").text().trim()
          const link = container.find("a").attr("href") || ""
          const snippet = container.find("div.VwiC3").text().trim()

          if (title && link) {
            results.push({
              title,
              link: link.startsWith("/url?") ? this.extractUrlFromRedirect(link) : link,
              snippet: snippet.slice(0, 200),
              position: results.length + 1,
            })
          }
        })
      }

      return results.slice(0, 20)
    } catch (error) {
      console.warn("[SearchAdapter] Built-in scraper error:", error instanceof Error ? error.message : String(error))
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

  private async executeScraplingSearch(query: string): Promise<SearchResult[]> {
    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws`

      const command = [
        "scrapling",
        "extract",
        "stealthy-fetch",
        `"${searchUrl}"`,
        "--css-selector",
        ".g .rc",
        "--solve-cloudflare",
        "-",
      ].join(" ")

      const output = execSync(command, {
        encoding: "utf-8",
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      })

      return this.parseScraplingOutput(output)
    } catch (error) {
      console.warn("[SearchAdapter] Scrapling error:", error instanceof Error ? error.message : String(error))
      return []
    }
  }

  private parseScraplingOutput(output: string): SearchResult[] {
    if (!output || !output.trim()) return []

    try {
      const results: SearchResult[] = []
      const lines = output.split("\n").filter((line) => line.trim())

      for (const line of lines) {
        try {
          const item = JSON.parse(line)
          if (item.title || item.link || item.text) {
            results.push({
              title: item.title || item.text || item.name || "",
              link: item.link || item.url || "",
              snippet: item.snippet || item.description || item.text || "",
              position: results.length + 1,
              date: item.date,
            })
          }
        } catch {
          continue
        }
      }

      return results
    } catch {
      return []
    }
  }

  private async executeZenserpSearch(
    query: string,
    zenserpKey: string,
  ): Promise<SearchResult[]> {
    try {
      const response = await axios.get("https://api.zenserp.com/search", {
        params: {
          q: query,
          tbm: "nws",
          size: 20,
        },
        headers: {
          "X-API-Key": zenserpKey,
        },
        timeout: 10000,
      })

      return this.parseResponse(response.data)
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("[SearchAdapter] Zenserp API error:", error.message)
      }
      return []
    }
  }

  protected parseResponse(data: unknown): SearchResult[] {
    if (!data) return []

    const searchResults = data as Record<string, unknown>
    const resultsArray = searchResults.organic ?? searchResults.results ?? []

    if (!Array.isArray(resultsArray)) return []

    return resultsArray.map((item): SearchResult => {
      const r = item as Record<string, unknown>
      return {
        title: String(r.title ?? ""),
        link: String(r.link ?? r.url ?? ""),
        snippet: String(r.snippet ?? r.description ?? ""),
        position: Number(r.position) || undefined,
        date: r.date ? String(r.date) : undefined,
      }
    })
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as SearchResult[]

    return items
      .filter((item) => this.isHighIntent(item))
      .map((item): Opportunity => {
        const domain = this.extractDomain(item.link)
        const signal = this.inferSignal(item.title, item.snippet)

        return this.createOpportunity({
          name: this.extractCompanyName(item.title, domain),
          domain,
          source: this.source,
          signal,
          sub_signal: this.extractSubSignal(item.snippet),
          confidence: this.calculateConfidence(item, signal),
          metadata: {
            title: item.title,
            snippet: item.snippet,
            url: item.link,
            date: item.date,
          },
        })
      })
  }

  protected isHighIntent(item: SearchResult): boolean {
    const text = `${item.title} ${item.snippet}`.toLowerCase()

    const highIntentPhrases = [
      "looking for",
      "need help",
      "alternatives to",
      "switching from",
      "frustrated with",
      "problem with",
      "tired of",
      "best tool for",
      "hiring",
      "recommend",
      "review",
      "vs ",
      "compared",
    ]

    return highIntentPhrases.some((phrase) => text.includes(phrase))
  }

  protected inferSignal(title: string, snippet: string): string {
    const text = `${title} ${snippet}`.toLowerCase()

    if (
      text.includes("hiring") ||
      text.includes("job opening") ||
      text.includes("career")
    ) {
      return SignalType.HIRING
    }
    if (
      text.includes("funding") ||
      text.includes("raised") ||
      text.includes("series")
    ) {
      return SignalType.FUNDING
    }
    if (text.includes("launch") || text.includes("released")) {
      return SignalType.LAUNCH
    }
    if (
      text.includes("pain") ||
      text.includes("problem") ||
      text.includes("frustrat") ||
      text.includes("struggling") ||
      text.includes("issue") ||
      text.includes("broken")
    ) {
      return SignalType.PAIN
    }
    if (text.includes("ad ") || text.includes("advertising")) {
      return SignalType.ADVERTISING
    }
    if (text.includes("partner")) {
      return SignalType.PARTNERSHIP
    }
    if (text.includes("using ") || text.includes("tool") || text.includes("software")) {
      return SignalType.TECH_USAGE
    }
    if (
      text.includes("growth") ||
      text.includes("scaling") ||
      text.includes("expanding")
    ) {
      return SignalType.GROWTH_ACTIVITY
    }

    return SignalType.PAIN
  }

  protected extractSubSignal(snippet: string): string | undefined {
    const lower = snippet.toLowerCase()

    if (lower.includes("cold calling")) return "cold_calling"
    if (lower.includes("email")) return "email_outreach"
    if (lower.includes("lead gen")) return "lead_generation"
    if (lower.includes("sales")) return "sales"
    if (lower.includes("marketing")) return "marketing"
    if (lower.includes("crm")) return "crm"
    if (lower.includes("automation")) return "automation"

    return undefined
  }

  protected calculateConfidence(item: SearchResult, signal: string): number {
    let confidence = 0.5

    const text = `${item.title} ${item.snippet}`.toLowerCase()

    if (item.date && (item.date.includes("2026") || item.date.includes("2025"))) {
      confidence += 0.15
    }

    const urgencyPhrases = ["need", "looking for", "want", "trying to"]
    if (urgencyPhrases.some((p) => text.includes(p))) {
      confidence += 0.1
    }

    const comparisonPhrases = ["vs ", "compare", "alternatives", "switching"]
    if (comparisonPhrases.some((p) => text.includes(p))) {
      confidence += 0.15
    }

    return Math.min(1, confidence)
  }

  protected extractCompanyName(
    title: string,
    domain?: string,
  ): string {
    if (domain) {
      return domain.replace(/^www\./, "").replace(/\..*/, "")
    }

    const cleaned = title
      .replace(/[-|–]\s*.*$/, "")
      .replace(/\s+(review|vs|compare|alternatives|alternative).*$/i, "")
      .trim()

    return cleaned || "Unknown"
  }
}

declare module "../adapter" {
  interface AdapterConfig {
    zenserpApiKey?: string
  }
}