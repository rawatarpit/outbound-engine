import axios from "axios"
import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"
import pino from "pino"

const logger = pino({ level: "info" })

interface BrowserlessResponse {
  data?: string
  screenshot?: string
  success: boolean
  error?: string
}

interface BrowserlessConfig extends AdapterConfig {
  browserlessUrl?: string
  timeout?: number
}

export class BrowserlessAdapter extends DiscoveryAdapter {
  source = "browserless"
  supportedSignals = [
    SignalType.TECH_USAGE,
    SignalType.PAIN,
    SignalType.HIRING,
    SignalType.FUNDING,
    SignalType.LAUNCH,
  ]

  private defaultUrl: string

  constructor(config: BrowserlessConfig = {}) {
    super(config)
    this.defaultUrl = config.browserlessUrl || process.env.BROWSERLESS_URL || "ws://localhost:3000"
  }

  override supports(signal: SignalType | string): boolean {
    return true
  }

  async fetch(params: AdapterParams): Promise<FetchResult> {
    if (!params.query.startsWith("http://") && !params.query.startsWith("https://")) {
      return { raw: [], metadata: { source: "browserless", skipped: true, reason: "not_a_url" } }
    }

    const url = this.defaultUrl.replace(/\/$/, "")

    logger.info({ stage: "BROWSERLESS_REQUEST", url: params.query })

    try {
      const response = await axios.post<BrowserlessResponse>(
        `${url}/scrape`,
        {
          url: params.query,
          options: {
            headless: true,
            stealStyle: false,
            timeout: this.config.timeout || 30000,
          },
        },
        {
          timeout: 60000,
          headers: { "Content-Type": "application/json" },
        }
      )

      const result = response.data

      if (!result.success) {
        logger.error({ stage: "BROWSERLESS_ERROR", url: params.query, error: result.error })
        return { raw: [], metadata: { source: "browserless", success: false, error: result.error } }
      }

      logger.info({ stage: "BROWSERLESS_SUCCESS", url: params.query })

      return {
        raw: [result],
        metadata: {
          source: "browserless",
          url: params.query,
          success: true,
        },
      }
    } catch (error) {
      logger.error({
        stage: "BROWSERLESS_ERROR",
        url: params.query,
        error: error instanceof Error ? error.message : String(error),
      })
      return { raw: [], metadata: { source: "browserless", success: false, error: String(error) } }
    }
  }

  normalize(raw: unknown[]): Opportunity[] {
    const results = raw as BrowserlessResponse[]
    const opportunities: Opportunity[] = []

    for (const result of results) {
      if (!result.success || !result.data) continue

      const html = result.data
      const domain = this.extractDomain("")

      const signals = this.detectSignals(html)

      for (const signal of signals) {
        opportunities.push(
          this.createOpportunity({
            name: domain?.replace(/^www\./, "") || "Unknown",
            domain,
            source: this.source,
            signal: signal.type,
            confidence: signal.confidence,
            metadata: {
              snippet: html.slice(0, 500),
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

    if (lowerContent.includes("hiring") || lowerContent.includes("careers")) {
      signals.push({ type: SignalType.HIRING, confidence: 0.75 })
    }
    if (lowerContent.includes("raised") || lowerContent.includes("funding")) {
      signals.push({ type: SignalType.FUNDING, confidence: 0.78 })
    }

    return signals
  }
}

declare module "../adapter" {
  interface AdapterConfig {
    browserlessUrl?: string
    timeout?: number
  }
}