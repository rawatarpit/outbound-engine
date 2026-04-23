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
          num: this.config.maxResults,
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

      return this.createOpportunity({
        name: item.title.replace(/ [-|].*$/, "").trim(),
        domain,
        source: this.source,
        signal: SignalType.PAIN,
        confidence: 0.5,
        metadata: {
          snippet: item.snippet,
          url: item.link,
        },
      })
    })
  }
}