import axios from "axios"
import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"
import pino from "pino"

const logger = pino({ level: "info" })

interface Crawl4AIPage {
  url: string
  html?: string
  markdown?: string
  extracted_content?: string
  success: boolean
  error?: string
}

interface Crawl4AIConfig extends AdapterConfig {
  crawl4aiUrl?: string
  waitFor?: number
  jsEnabled?: boolean
}

export class Crawl4AIAdapter extends DiscoveryAdapter {
  source = "crawl4ai"
  supportedSignals = [
    SignalType.TECH_USAGE,
    SignalType.PAIN,
    SignalType.LAUNCH,
    SignalType.HIRING,
    SignalType.FUNDING,
    SignalType.GROWTH_ACTIVITY,
  ]

  private defaultUrl: string

  constructor(config: Crawl4AIConfig = {}) {
    super(config)
    this.defaultUrl = config.crawl4aiUrl || process.env.CRAWL4AI_URL || "http://localhost:8000"
  }

  override supports(signal: SignalType | string): boolean {
    return true
  }

  async fetch(params: AdapterParams): Promise<FetchResult> {
    if (!params.query.startsWith("http://") && !params.query.startsWith("https://")) {
      return { raw: [], metadata: { source: "crawl4ai", skipped: true, reason: "not_a_url" } }
    }

    const url = this.defaultUrl.replace(/\/$/, "")
    const apiUrl = `${url}/crawl`

    logger.info({ stage: "CRAWL4AI_REQUEST", url: params.query })

    try {
      const response = await axios.post<Crawl4AIPage>(
        apiUrl,
        {
          urls: [params.query],
          config: {
            headless: this.config.jsEnabled ?? true,
            wait_for_selector: this.config.waitFor ? `${this.config.waitFor}ms` : "2s",
            page_timeout: 30000,
          },
        },
        {
          timeout: 60000,
          headers: { "Content-Type": "application/json" },
        }
      )

      const page = response.data

      if (!page.success) {
        logger.error({ stage: "CRAWL4AI_ERROR", url: params.query, error: page.error })
        return { raw: [], metadata: { source: "crawl4ai", success: false, error: page.error } }
      }

      logger.info({ stage: "CRAWL4AI_SUCCESS", url: params.query, contentLength: page.markdown?.length || 0 })

      return {
        raw: [page],
        metadata: {
          source: "crawl4ai",
          url: params.query,
          success: true,
          contentLength: page.markdown?.length || 0,
        },
      }
    } catch (error) {
      logger.error({
        stage: "CRAWL4AI_ERROR",
        url: params.query,
        error: error instanceof Error ? error.message : String(error),
      })
      return { raw: [], metadata: { source: "crawl4ai", success: false, error: String(error) } }
    }
  }

  normalize(raw: unknown[]): Opportunity[] {
    const pages = raw as Crawl4AIPage[]
    const opportunities: Opportunity[] = []

    for (const page of pages) {
      if (!page.success) continue

      const content = page.markdown || page.extracted_content || page.html || ""

      const domain = this.extractDomain(page.url)
      const titleMatch = content.match(/<title>([^<]+)<\/title>/i) || content.match(/^#\s+(.+)$/m)
      const title = titleMatch?.[1] || domain || "Unknown"

      const signals = this.detectSignals(content)

      for (const signal of signals) {
        opportunities.push(
          this.createOpportunity({
            name: domain?.replace(/^www\./, "") || "Unknown",
            domain,
            source: this.source,
            signal: signal.type,
            confidence: signal.confidence,
            metadata: {
              url: page.url,
              snippet: content.slice(0, 500),
              signal_type: signal.type,
            },
          })
        )
      }

      if (signals.length === 0) {
        opportunities.push(
          this.createOpportunity({
            name: domain?.replace(/^www\./, "") || "Unknown",
            domain,
            source: this.source,
            signal: SignalType.TECH_USAGE,
            confidence: 0.5,
            metadata: {
              url: page.url,
              snippet: content.slice(0, 500),
            },
          })
        )
      }
    }

    return opportunities
  }

  private detectSignals(content: string): Array<{ type: string; confidence: number }> {
    const signals: Array<{ type: string; confidence: number }> = []
    const lowerContent = content.toLowerCase()

    if (lowerContent.includes("hiring") || lowerContent.includes("job opening") || lowerContent.includes("we're looking")) {
      signals.push({ type: SignalType.HIRING, confidence: 0.75 })
    }
    if (lowerContent.includes("raised") || lowerContent.includes("funding") || lowerContent.includes("series")) {
      signals.push({ type: SignalType.FUNDING, confidence: 0.8 })
    }
    if (lowerContent.includes("launch") || lowerContent.includes("announcing") || lowerContent.includes("beta")) {
      signals.push({ type: SignalType.LAUNCH, confidence: 0.72 })
    }
    if (lowerContent.includes("growth") || lowerContent.includes("scaling") || lowerContent.includes("expanding")) {
      signals.push({ type: SignalType.GROWTH_ACTIVITY, confidence: 0.68 })
    }

    return signals
  }
}

declare module "../adapter" {
  interface AdapterConfig {
    crawl4aiUrl?: string
    waitFor?: number
    jsEnabled?: boolean
  }
}