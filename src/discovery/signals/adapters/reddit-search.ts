import axios from "axios"
import pino from "pino"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"
import { getApiKey } from "../../utils/api-keys"

const logger = pino({ level: "debug" })

export interface RedditSearchConfig {
  query: string
  intent_id: string
  signal: string
  limit?: number
  clientId?: string
}

const USER_AGENTS = [
  "Mozilla/5.0 (compatible; OutboundBot/1.0)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
]

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

let redditToken: string | null = null
let tokenExpiresAt = 0

async function getRedditToken(clientId?: string): Promise<string | null> {
  const dbClientId = await getApiKey("reddit_client_id", clientId)
  const dbClientSecret = await getApiKey("reddit_client_secret", clientId)
  const clientIdVal = dbClientId || process.env.REDDIT_CLIENT_ID
  const clientSecret = dbClientSecret || process.env.REDDIT_CLIENT_SECRET
  if (!clientIdVal || !clientSecret) return null

  if (redditToken && Date.now() < tokenExpiresAt) return redditToken

  try {
    const params = new URLSearchParams()
    params.append("grant_type", "client_credentials")
    const auth = Buffer.from(`${clientIdVal}:${clientSecret}`).toString("base64")
    const response = await axios.post("https://www.reddit.com/api/v1/access_token", params.toString(), {
      headers: {
        Authorization: `Basic ${auth}`,
        "User-Agent": "outbound-engine/1.0",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 10000,
    })
    redditToken = response.data.access_token
    tokenExpiresAt = Date.now() + (response.data.expires_in - 60) * 1000
    return redditToken
  } catch {
    return null
  }
}

function extractCompanyFromReddit(post: any): { name: string; domain: string; summary: string } | null {
  const title = post.title || ""
  const selftext = post.selftext || ""
  const fullContent = (title + " " + selftext).substring(0, 2000)

  const companyPatterns = [
    /([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*)\s+(?:is|has|launched|raised|built|created|started|announced|released|introduced)/g,
    /(?:I work at|we're at|working at|at)\s+([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*)/gi,
    /(?:Using|Tried|Built|Integrated)\s+([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*)/g,
  ]

  const aggregatorWords = ["app", "tool", "software", "platform", "service", "saas", "startup", "company", "looking for", "best", "alternative", "job", "hiring", "career"]

  for (const pattern of companyPatterns) {
    const matches = title.matchAll(pattern)
    for (const match of matches) {
      const name = match[1].trim()
      if (name.length >= 3 && name.length <= 50) {
        const nameLower = name.toLowerCase()
        if (!aggregatorWords.some(w => nameLower.includes(w)) && !name.match(/^(We|I|They|It|This|That|Any|All)$/)) {
          return { name, domain: "", summary: fullContent }
        }
      }
    }
  }

  const mentionPattern = /([A-Z][a-z0-9]+(?:[A-Z0-9][a-z0-9]*)+)/g
  const mentions = title.match(mentionPattern)
  if (mentions) {
    for (const mention of mentions) {
      if (mention.length >= 4 && mention.length <= 30) {
        return { name: mention, domain: "", summary: fullContent }
      }
    }
  }

  return null
}

export async function redditSearchAdapter(
  config: RedditSearchConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, limit = 10, clientId } = config

  const token = await getRedditToken(clientId)
  const headers: Record<string, string> = {
    "User-Agent": getRandomUserAgent(),
    "Accept": "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  try {
    const response = await axios.get("https://oauth.reddit.com/search.json", {
      params: {
        q: query,
        sort: "relevance",
        limit,
        t: "year",
        restrict_sr: false,
      },
      headers,
      timeout: 10000,
    })

    if (!response.data?.data?.children) {
      return { companies: [], contacts: [] }
    }

    const companies: DiscoveryCompany[] = response.data.data.children
      .map((child: any) => {
        const post = child.data
        const extracted = extractCompanyFromReddit(post)

        const name = extracted?.name || post.title?.substring(0, 80) || "Unknown"
        const domain = extracted?.domain || post.domain || ""
        const summary = extracted?.summary || post.selftext || post.title || ""

        return {
          source: "reddit_search",
          source_url: `https://reddit.com${post.permalink}`,
          risk: DiscoveryRisk.MODERATE_PUBLIC,
          domain,
          name,
          title: post.title || "",
          summary,
          signal_type: signal,
          relevance_score: 50,
          urgency_score: 30,
          fit_reason: `Reddit search match for: ${query}`,
          raw: {
            query,
            intent_id,
            signal,
            subreddit: post.subreddit,
            author: post.author,
            score: post.score,
            num_comments: post.num_comments,
          },
        } as DiscoveryCompany
      })
      .filter((c: DiscoveryCompany) => c.name && c.name !== "Unknown" && c.name.length >= 3)

    logger.info({ query, count: companies.length }, "Reddit search adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Reddit search adapter failed")
    return { companies: [], contacts: [] }
  }
}
