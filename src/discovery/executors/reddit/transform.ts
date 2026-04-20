import {
  DiscoveryResult,
  DiscoveryRisk,
  DiscoveryCompany
} from "../../types"

interface RedditPost {
  id: string
  title: string
  selftext: string
  author: string
  subreddit: string
  ups: number
  url: string
  created_utc: number
  over_18: boolean
}

export function transformRedditResults(
  posts: RedditPost[],
  sourceUrl: string
): DiscoveryResult {
  const seenDomains = new Set<string>()
  const companies: DiscoveryCompany[] = []

  for (const post of posts) {
    const rawDomain =
      extractDomain(post.selftext) ?? extractDomain(post.title)

    if (!rawDomain) continue

    const domain = normalizeDomain(rawDomain)
    if (!domain) continue
    if (seenDomains.has(domain)) continue

    seenDomains.add(domain)

    companies.push({
      domain,
      source: "reddit",
      source_url: post.url ?? sourceUrl,
      risk: DiscoveryRisk.MODERATE_PUBLIC,
      confidence: computeConfidence(post),
      intent_score: computeIntentScore(post),
      requires_enrichment: true,
      raw: {
        id: post.id,
        title: post.title,
        subreddit: post.subreddit,
        ups: post.ups,
        created_utc: post.created_utc
      }
    })
  }

  return {
    companies,
    meta: {
      executor: "reddit",
      risk: DiscoveryRisk.MODERATE_PUBLIC,
      total_fetched: posts.length,
      total_companies: companies.length,
      source_health: "healthy"
    }
  }
}

/* ---------------- DOMAIN EXTRACTION ---------------- */

function extractDomain(text?: string | null): string | null {
  if (!text) return null

  const match = text.match(
    /\b((?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,})(?:\/[^\s]*)?/i
  )

  if (!match) return null

  return match[1]
}

/* ---------------- DOMAIN NORMALIZATION ---------------- */

function normalizeDomain(input: string): string | null {
  try {
    let domain = input.trim().toLowerCase()

    domain = domain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .split("?")[0]
      .split("#")[0]

    if (!domain.includes(".")) return null
    if (domain.length < 4) return null
    if (domain.endsWith(".")) return null

    return domain
  } catch {
    return null
  }
}

/* ---------------- CONFIDENCE MODEL ---------------- */

function computeConfidence(post: RedditPost): number {
  let score = 0.3

  if (post.ups > 10) score += 0.2
  if (post.ups > 50) score += 0.2
  if (post.selftext?.length > 100) score += 0.2
  if (extractDomain(post.selftext)) score += 0.1

  return Math.min(score, 1)
}

/* ---------------- INTENT SIGNAL ---------------- */

function computeIntentScore(post: RedditPost): number {
  const text = `${post.title} ${post.selftext}`.toLowerCase()

  const signals = [
    "looking for",
    "recommend",
    "suggest",
    "tool",
    "software",
    "hiring",
    "need help",
    "best way to"
  ]

  const matches = signals.filter(s => text.includes(s)).length

  return Math.min(matches * 0.2, 1)
}