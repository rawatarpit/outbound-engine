import axios from "axios"
import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"
import pino from "pino"

const logger = pino({ level: "info" })

interface SearxngResult {
  title: string
  url: string
  content?: string
  img_src?: string
  engine: string
}

interface SearxngResponse {
  results: SearxngResult[]
  answers?: string[]
}

interface SearxngConfig extends AdapterConfig {
  searxngUrl?: string
  engines?: string[]
}

export class SearxngAdapter extends DiscoveryAdapter {
  source = "searxng"
  supportedSignals = Object.values(SignalType)

  private defaultUrl: string

  constructor(config: SearxngConfig = {}) {
    super(config)
    this.defaultUrl = config.searxngUrl || process.env.SEARXNG_URL || "http://localhost:8080"
  }

  override supports(signal: SignalType | string): boolean {
    return true
  }

  async fetch(params: AdapterParams): Promise<FetchResult> {
    const url = this.buildUrl(params.query)

    logger.info({ stage: "SEARXNG_REQUEST", query: params.query, url })

    try {
      const response = await axios.get<SearxngResponse>(url, {
        timeout: 30000,
        headers: { Accept: "application/json" },
      })

      const results = (response.data.results ?? []) as SearxngResult[]

      logger.info({ stage: "SEARXNG_SUCCESS", query: params.query, count: results.length })

      return {
        raw: results,
        metadata: {
          searchQuery: params.query,
          resultCount: results.length,
          source: "searxng",
          signal: params.signal,
          engines: this.config.engines || ["google", "bing", "duckduckgo"],
        },
      }
    } catch (error) {
      logger.error({
        stage: "SEARXNG_ERROR",
        query: params.query,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as SearxngResult[]

    return items.map((item): Opportunity => {
      const domain = this.extractDomain(item.url)
      const titleLower = item.title?.toLowerCase() || ""
      const contentLower = item.content?.toLowerCase() || ""

      let signal: string = SignalType.PAIN
      let confidence = 0.55

      if (titleLower.includes("hiring") || titleLower.includes("jobs") || contentLower.includes("hiring")) {
        signal = SignalType.HIRING
        confidence = 0.75
      } else if (
        titleLower.includes("funding") ||
        titleLower.includes("raised") ||
        contentLower.includes("funding") ||
        contentLower.includes("raised")
      ) {
        signal = SignalType.FUNDING
        confidence = 0.78
      } else if (
        titleLower.includes("launch") ||
        titleLower.includes("new product") ||
        contentLower.includes("launch")
      ) {
        signal = SignalType.LAUNCH
        confidence = 0.72
      } else if (
        titleLower.includes("review") ||
        titleLower.includes("alternative") ||
        titleLower.includes("vs") ||
        titleLower.includes("compare")
      ) {
        signal = SignalType.TECH_USAGE
        confidence = 0.65
      } else if (titleLower.includes("sponsor") || titleLower.includes("partner")) {
        signal = SignalType.PARTNERSHIP
        confidence = 0.8
      }

      return this.createOpportunity({
        name: this.extractCompanyName(item.title, domain),
        domain,
        source: this.source,
        signal,
        confidence,
        metadata: {
          snippet: item.content,
          url: item.url,
          engine: item.engine,
        },
      })
    })
  }

  private buildUrl(query: string): string {
    const baseUrl = this.defaultUrl.replace(/\/$/, "")
    const engines = (this.config.engines || ["google", "bing"]).join(",")
    const params = new URLSearchParams({
      q: query,
      format: "json",
      engines: engines,
      limit: String(this.config.maxResults || 20),
    })

    return `${baseUrl}/search?${params.toString()}`
  }

  private extractCompanyName(title: string, domain?: string): string {
    if (domain) {
      return domain.replace(/^www\./, "").replace(/\..*/, "")
    }
    return title.replace(/[-|–]\s*.*$/, "").replace(/\s*[-|]\s*.*$/, "").trim() || "Unknown"
  }
}

declare module "../adapter" {
  interface AdapterConfig {
    searxngUrl?: string
    engines?: string[]
  }
}