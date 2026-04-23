import axios from "axios"
import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"

interface JobResultConfig extends AdapterConfig {
  appId?: string
  country?: string
}

interface JobResult {
  title: string
  company: string
  location: string
  description: string
  redirect_url: string
}

export class JobsAdapter extends DiscoveryAdapter {
  source = "adzuna"
  supportedSignals = [SignalType.HIRING]

  private baseUrl = "https://api.adzuna.com/v1/api/jobs"

  async fetch(params: AdapterParams): Promise<FetchResult> {
    if (!this.config.apiKey) {
      throw new Error("Adzuna API key required")
    }

    const appId = this.config.appId || "demo"
    const country = (this.config.country || "us") as string

    try {
      const response = await axios.get(`${this.baseUrl}/${country}/search/${1}`, {
        params: {
          app_id: appId,
          app_key: this.config.apiKey,
          what: params.query,
          max_results: this.config.maxResults,
        },
      })

      const results = (response.data.results ?? []) as JobResult[]
      return {
        raw: results,
        metadata: {
          searchQuery: params.query,
          resultCount: results.length,
        },
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Adzuna API error: ${error.message}`)
      }
      throw error
    }
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as JobResult[]

    return items
      .map((item): Opportunity | null => {
        const domain = item.redirect_url
          ? this.extractDomain(item.redirect_url)
          : undefined

        if (!domain && !item.company) return null

        const name = item.company || domain?.replace(/^www\./, "").replace(/\..*/, "") || "Unknown"

        return this.createOpportunity({
          name,
          domain,
          source: this.source,
          signal: SignalType.HIRING,
          sub_signal: "job_posting",
          confidence: 0.7,
          metadata: {
            title: item.title,
            location: item.location,
            description: item.description?.slice(0, 500),
          },
        })
      })
      .filter((o): o is Opportunity => o !== null)
  }
}