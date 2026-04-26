import axios from "axios"
import { DiscoveryAdapter, type AdapterParams, type FetchResult } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"

interface SerperResult {
  title: string
  link: string
  snippet: string
}

export class GoogleSerperAdapter extends DiscoveryAdapter {
  source = "google_serper"
  supportedSignals = Object.values(SignalType)

  private baseUrl = "https://google.serper.dev/search"

  async fetch(params: AdapterParams): Promise<FetchResult> {
    if (!this.config.apiKey) {
      throw new Error("Serper API key required")
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          q: params.query,
          num: this.config.maxResults || 20,
          type: "search",
        },
        {
          headers: {
            "X-API-Key": this.config.apiKey,
            "Content-Type": "application/json",
          },
        },
      )

      const results = (response.data.organic ?? []) as SerperResult[]
      return {
        raw: results,
        metadata: {
          searchQuery: params.query,
          resultCount: results.length,
          source: "google_serper",
          signal: params.signal,
        },
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Serper API error: ${error.message}`)
      }
      throw error
    }
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as SerperResult[]

    return items.map((item): Opportunity => {
      const domain = this.extractDomain(item.link)
      const titleLower = item.title?.toLowerCase() || ""
      const snippetLower = item.snippet?.toLowerCase() || ""

      let signal: string = SignalType.PAIN
      if (titleLower.includes("hiring") || titleLower.includes("jobs") || snippetLower.includes("hiring")) {
        signal = SignalType.HIRING
      } else if (titleLower.includes("funding") || titleLower.includes("raised") || snippetLower.includes("funding") || snippetLower.includes("raised")) {
        signal = SignalType.FUNDING
      } else if (titleLower.includes("launch") || titleLower.includes("new product") || snippetLower.includes("launch")) {
        signal = SignalType.LAUNCH
      } else if (titleLower.includes("review") || titleLower.includes("alternative") || titleLower.includes("vs")) {
        signal = SignalType.TECH_USAGE
      }

      const confidence = signal === SignalType.HIRING ? 0.75 : signal === SignalType.FUNDING ? 0.78 : 0.55

      return this.createOpportunity({
        name: item.title.replace(/ [-|].*$/, "").trim(),
        domain,
        source: this.source,
        signal,
        confidence,
        metadata: {
          snippet: item.snippet,
          url: item.link,
        },
      })
    })
  }
}