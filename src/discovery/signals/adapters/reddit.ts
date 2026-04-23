import axios from "axios"
import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"

interface RedditConfig extends AdapterConfig {
  subreddits?: string
}

interface RedditPost {
  title: string
  selftext: string
  author: string
  subreddit: string
  url: string
  score: number
  num_comments: number
  created_utc: number
}

export class RedditAdapter extends DiscoveryAdapter {
  source = "reddit"
  supportedSignals = [SignalType.PAIN, SignalType.GROWTH_ACTIVITY]

  private baseUrl = "https://www.reddit.com"

  async fetch(params: AdapterParams): Promise<FetchResult> {
    try {
      const subreddits = (this.config.subreddits || "all") as string
      const response = await axios.get(`${this.baseUrl}/r/${subreddits}/search.json`, {
        params: {
          q: params.query,
          limit: this.config.maxResults,
          sort: "relevance",
          restrict_sr: false,
        },
        headers: {
          "User-Agent": "OutboundEngine/1.0",
        },
      })

      const children = response.data.data?.children ?? []
      const results = children.map((c: { data: RedditPost }) => c.data)

      return {
        raw: results,
        metadata: {
          searchQuery: params.query,
          subreddits,
          resultCount: results.length,
        },
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Reddit API error: ${error.message}`)
      }
      throw error
    }
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as RedditPost[]

    return items
      .map((item): Opportunity | null => {
        const domain = item.url ? this.extractDomain(item.url) : undefined
        const authorDomain = item.author

        if (!domain && !authorDomain) return null

        const signal: SignalType =
          item.title.toLowerCase().includes("problem") ||
          item.title.toLowerCase().includes("struggling") ||
          item.title.toLowerCase().includes("frustrat")
            ? SignalType.PAIN
            : SignalType.GROWTH_ACTIVITY

        return this.createOpportunity({
          name: domain?.replace(/^www\./, "").replace(/\..*/, "") || item.author,
          domain,
          source: this.source,
          signal,
          sub_signal: "reddit_post",
          confidence: this.parseConfidence(item.score / 1000),
          metadata: {
            title: item.title,
            body: item.selftext?.slice(0, 500),
            subreddit: item.subreddit,
            comments: item.num_comments,
          },
        })
      })
      .filter((o): o is Opportunity => o !== null)
  }
}