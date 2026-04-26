import axios from "axios"
import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"

interface JobResult {
  title: string
  company: string
  location: string
  description: string
  redirect_url: string
}

export class JobsAdapter extends DiscoveryAdapter {
  source = "adzuna"
  supportedSignals = [
    SignalType.HIRING,
    SignalType.HIRING_SALES,
    SignalType.HIRING_ENGINEER,
    SignalType.REMOTE_HIRING,
  ]

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
          max_results: this.config.maxResults || 20,
        },
      })

      const results = (response.data.results ?? []) as JobResult[]
      return {
        raw: results,
        metadata: {
          searchQuery: params.query,
          resultCount: results.length,
          source: "adzuna",
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

        let signal: string = SignalType.HIRING
        const titleLower = item.title?.toLowerCase() || ""
        const descLower = item.description?.toLowerCase() || ""
        
        if (titleLower.includes("engineer") || titleLower.includes("developer") || titleLower.includes("tech") || titleLower.includes("software")) {
          signal = "hiring_engineer" as string
        } else if (titleLower.includes("sales") || titleLower.includes("account") || titleLower.includes("revenue") || titleLower.includes("executive")) {
          signal = "hiring_sales" as string
        } else if (titleLower.includes("remote") || titleLower.includes("work from home") || titleLower.includes("anywhere")) {
          signal = "remote_hiring" as string
        }

        const location = item.location || ""
        const isRemote = location.toLowerCase().includes("remote") || location.toLowerCase().includes("work from home")

        return this.createOpportunity({
          name,
          domain,
          source: this.source,
          signal: isRemote ? SignalType.REMOTE_HIRING : signal,
          sub_signal: "job_posting",
          confidence: 0.75,
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