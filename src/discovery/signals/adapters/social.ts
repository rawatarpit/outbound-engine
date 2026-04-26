import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"
import pino from "pino"
import * as cheerio from "cheerio"

const logger = pino({ level: "info" })

interface SocialResult {
  title: string
  link: string
  snippet: string
  author?: string
  source: string
  likes?: string
}

// Twitter/X via Nitter (privacy-friendly frontend)
async function fetchNitterSearch(query: string): Promise<SocialResult[]> {
  const results: SocialResult[] = []
  const instances = ["nitter.privacydev.net", "nitter.poast.org", "nitter.onediv.dev"]
  
  for (const instance of instances) {
    try {
      const searchUrl = `https://${instance}/search?q=${encodeURIComponent(query)}`
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(8000),
      })
      
      if (!response.ok) continue
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("div.tweet, article.tweet, .tweet-content").each((i, el) => {
        if (i > 15) return
        const $el = $(el)
        const username = $el.find(".username, a[href*='/']").first().text().trim()
        const content = $el.find(".tweet-content, .tweet-text, p").first().text().trim()
        const link = $el.find("a").first().attr("href") || ""
        
        if ((username || content) && content.length > 5) {
          results.push({
            title: content.slice(0, 100),
            link: link.startsWith("http") ? link : `https://twitter.com${link}`,
            snippet: content,
            author: username || undefined,
            source: "twitter",
          })
        }
      })
      
      if (results.length > 0) break
    } catch (e) {
      logger.debug({ instance, error: e })
    }
  }
  
  logger.info({ stage: "NITTER_SUCCESS", query, count: results.length })
  return results
}

// Mastodon Fediverse (no auth needed)
async function fetchMastodonSearch(query: string): Promise<SocialResult[]> {
  const results: SocialResult[] = []
  const instances = ["mastodon.social", "fosstodon.org", "hachy.social"]
  
  for (const instance of instances.slice(0, 1)) {
    try {
      const searchUrl = `https://${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=accounts`
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      })
      
      if (!response.ok) continue
      
      const data = await response.json()
      const accounts = data.accounts || []
      
      for (const account of accounts.slice(0, 10)) {
        results.push({
          title: account.display_name || account.username,
          link: account.url,
          snippet: account.note?.slice(0, 200) || "",
          author: `@${account.username}@${instance}`,
          source: "mastodon",
        })
      }
    } catch (e) {
      logger.debug({ stage: "MASTODON_ERROR", error: e })
    }
  }
  
  logger.info({ stage: "MASTODON_SUCCESS", query, count: results.length })
  return results
}

// Bluesky
async function fetchBlueskySearch(query: string): Promise<SocialResult[]> {
  const results: SocialResult[] = []
  
  // Using SkyFeed (bsky alternative)
  const skyfeedInstances = ["skyfeed.me", "bsky.recognyze.org"]
  
  for (const instance of skyfeedInstances.slice(0, 1)) {
    try {
      const searchUrl = `https://${instance}/search?q=${encodeURIComponent(query)}`
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
        signal: AbortSignal.timeout(8000),
      })
      
      if (!response.ok) continue
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("article, .post, .feed-item").each((i, el) => {
        if (i > 10) return
        const $el = $(el)
        const content = $el.find("p, .content, .text").first().text().trim()
        const author = $el.find(".author, .display-name").first().text().trim()
        
        if (content && content.length > 5) {
          results.push({
            title: content.slice(0, 100),
            link: "",
            snippet: content.slice(0, 200),
            author: author || undefined,
            source: "bluesky",
          })
        }
      })
    } catch (e) {
      logger.debug({ stage: "BLUESKY_ERROR", error: e })
    }
  }
  
  return results
}

// Lemmy/Kbin (Reddit alternative)
async function fetchLemmySearch(query: string): Promise<SocialResult[]> {
  const results: SocialResult[] = []
  const instances = ["lemmy.world", "programming.dev", "beehaw.org"]
  
  for (const instance of instances.slice(0, 1)) {
    try {
      const searchUrl = `https://${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=Posts`
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      })
      
      if (!response.ok) continue
      
      const data = await response.json()
      const posts = data.posts || []
      
      for (const post of posts.slice(0, 10)) {
        results.push({
          title: post.post?.name || "",
          link: post.post?.ap_id || "",
          snippet: post.post?.content?.slice(0, 200) || "",
          source: "lemmy",
        })
      }
    } catch (e) {
      logger.debug({ stage: "LEMMY_ERROR", error: e })
    }
  }
  
  logger.info({ stage: "LEMMY_SUCCESS", query, count: results.length })
  return results
}

// HackerNoon (more coverage)
async function fetchHackerNoonExtended(query: string): Promise<SocialResult[]> {
  const results: SocialResult[] = []
  
  try {
    // Tags page - more structured
    const tags = ["hiring", "startup", "funding", "saas", "growth", "marketing"]
    const randomTag = tags[Math.floor(Math.random() * tags.length)]
    
    const url = `https://hackernoon.com/tag/${randomTag}`
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("a[data-testid*='post'], h3 a").each((i, el) => {
        if (i > 10) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        
        if (title && title.length > 5) {
          results.push({
            title: title.slice(0, 150),
            link: href.startsWith("http") ? href : `https://hackernoon.com${href}`,
            snippet: "",
            source: "hackernoon",
          })
        }
      })
    }
  } catch (e) {
    logger.debug({ error: e })
  }
  
  return results
}

// TechCrunch
async function fetchTechCrunchSearch(query: string): Promise<SocialResult[]> {
  const results: SocialResult[] = []
  
  try {
    const url = `https://techcrunch.com/search/${encodeURIComponent(query)}`
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    })
    
    if (!response.ok) return []
    
    const html = await response.text()
    const $ = cheerio.load(html)
    
    $("a.post-title, h2 a, article a").each((i, el) => {
      if (i > 10) return
      const $el = $(el)
      const title = $el.text().trim()
      const href = $el.attr("href") || ""
      const excerpt = $el.closest("article")?.find(".excerpt").text().trim().slice(0, 150)
      
      if (title && title.length > 5) {
        results.push({
          title: title.slice(0, 150),
          link: href.startsWith("http") ? href : `https://techcrunch.com${href}`,
          snippet: excerpt || "",
          source: "techcrunch",
        })
      }
    })
    
    logger.info({ stage: "TECHCRUNCH_SUCCESS", query, count: results.length })
  } catch (e) {
    logger.debug({ error: e })
  }
  
  return results
}

// Y Combinator News (duplicate coverage)
async function fetchYCNewsExtended(query: string): Promise<SocialResult[]> {
  const results: SocialResult[] = []
  
  const urls = [
    `https://news.ycombinator.com/newest?q=${query}`,
    `https://news.ycombinator.com/ask?q=${query}`,
    `https://news.ycombinator.com/show?q=${query}`,
  ]
  
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      })
      
      if (!response.ok) continue
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("tr.athing").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.find("a.storylink").text().trim()
        const link = $el.find("a.storylink").attr("href") || ""
        
        if (title) {
          results.push({
            title,
            link,
            snippet: $el.siblings().find("td.subtext").text().trim().slice(0, 100),
            source: "hackernews",
          })
        }
      })
    } catch (e) {
      logger.debug({ url, error: e })
    }
  }
  
  return results
}

// Sidebar (tech news aggregator)
async function fetchSidebarSearch(query: string): Promise<SocialResult[]> {
  const results: SocialResult[] = []
  
  try {
    const url = `https://sidebar.io/search?q=${encodeURIComponent(query)}`
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("a[href*='/p/'], h3 a").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        
        if (title && title.length > 3) {
          results.push({
            title: title.slice(0, 150),
            link: href.startsWith("http") ? href : `https://sidebar.io${href}`,
            snippet: "",
            source: "sidebar",
          })
        }
      })
    }
  } catch {}
  
  return results
}

// SaaSGeek (product database)
async function fetchSaaSGeekSearch(query: string): Promise<SocialResult[]> {
  const results: SocialResult[] = []
  
  try {
    const url = `https://saasgeek.io/search?q=${encodeURIComponent(query)}`
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("a[href*='/product/'], .product-name").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        
        if (title && title.length > 2) {
          results.push({
            title,
            link: href.startsWith("http") ? href : `https://saasgeek.io${href}`,
            snippet: "",
            source: "saasgeek",
          })
        }
      })
    }
  } catch {}
  
  return results
}

// Betalist (new startups)
async function fetchBetalistSearch(query: string): Promise<SocialResult[]> {
  const results: SocialResult[] = []
  
  try {
    const url = `https://www.producthunt.com/search?q=${encodeURIComponent(query)}`
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("h3[data-testid='product-name'], .product-name").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        
        if (title && title.length > 2) {
          results.push({
            title,
            link: "",
            snippet: "",
            source: "producthunt",
          })
        }
      })
    }
  } catch {}
  
  return results
}

export class SocialAdapter extends DiscoveryAdapter {
  source = "social"
  supportedSignals = [
    SignalType.HIRING,
    SignalType.HIRING_SALES,
    SignalType.HIRING_ENGINEER,
    SignalType.REMOTE_HIRING,
    SignalType.FUNDING,
    SignalType.FUNDING_ANNOUNCEMENT,
    SignalType.LAUNCH,
    SignalType.PRODUCT_LAUNCH,
    SignalType.PAIN,
    SignalType.TECH_USAGE,
    SignalType.GROWTH_ACTIVITY,
    SignalType.EXPANSION,
  ]

  constructor(config: AdapterConfig = {}) {
    super(config)
  }

  override supports(signal: string): boolean {
    return true
  }

  async fetch(params: AdapterParams): Promise<FetchResult> {
    const results = await this.executeSearch(params.query, params.signal)
    return {
      raw: results,
      metadata: {
        searchQuery: params.query,
        resultCount: results.length,
        source: "social",
      },
    }
  }

  private async executeSearch(query: string, signal: string): Promise<SocialResult[]> {
    const allResults: SocialResult[] = []

    const promises = [
      fetchNitterSearch(query),
      fetchMastodonSearch(query),
      fetchLemmySearch(query),
      fetchTechCrunchSearch(query),
      fetchSidebarSearch(query),
    ]

    const [
      nitter,
      mastodon,
      lemmy,
      techcrunch,
      sidebar,
    ] = await Promise.all(promises)

    allResults.push(...nitter, ...mastodon, ...lemmy, ...techcrunch, ...sidebar)

    // Signal-specific additions
    if (signal === "funding" || signal === "launch") {
      const [hc, yc] = await Promise.all([
        fetchHackerNoonExtended(query),
        fetchYCNewsExtended(query),
      ])
      allResults.push(...hc, ...yc)
    }

    if (signal === "tech_usage" || signal === "pain") {
      const sg = await fetchSaaSGeekSearch(query)
      allResults.push(...sg)
    }

    logger.info({ stage: "SOCIAL_SEARCH_COMPLETE", query, totalResults: allResults.length })
    return allResults.slice(0, 40)
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as SocialResult[]
    logger.info({ stage: "SOCIAL_NORMALIZE", count: items.length })

    return items
      .filter((item) => item.title || item.link)
      .map((item) => {
        const signalType = this.classifyIntent(item.title, item.snippet, item.source)
        const score = this.calculateScore(signalType)
        const domain = item.link ? this.extractDomain(item.link) : undefined

        return this.createOpportunity({
          name: domain || this.extractName(item.title, item.author),
          domain,
          source: item.source || this.source,
          signal: this.mapToSignal(signalType),
          sub_signal: signalType,
          confidence: score,
          metadata: {
            title: item.title,
            snippet: item.snippet,
            link: item.link,
            author: item.author,
          },
        })
      })
  }

  private classifyIntent(title: string, snippet: string, source: string): string {
    const text = (title + " " + snippet).toLowerCase()

    const hiring = ["hiring", "job", "role", "seeking", "looking for", "opening", "position", "apply"]
    const funding = ["raised", "funding", "seed", "series", "invested", "vc", "capital", "backed"]
    const launch = ["launch", "release", "announce", "new", "beta", "public", "introducing"]
    const pain = ["help", "problem", "issue", "error", "broken", "doesn't work", "struggling", "frustrated"]
    const tech = ["using", "built with", "tech", "tool", "software", "platform", "stack"]

    for (const kw of funding) if (text.includes(kw)) return "funding"
    for (const kw of launch) if (text.includes(kw)) return "launch"
    for (const kw of hiring) if (text.includes(kw)) return "hiring"
    for (const kw of tech) if (text.includes(kw)) return "tech_usage"
    for (const kw of pain) if (text.includes(kw)) return "pain"

    return "discussion"
  }

  private calculateScore(intentType: string): number {
    const scores: Record<string, number> = {
      hiring: 0.88,
      funding: 0.85,
      launch: 0.78,
      tech_usage: 0.7,
      pain: 0.82,
      discussion: 0.35,
    }
    return scores[intentType] ?? 0.5
  }

  private mapToSignal(type: string): string {
    const map: Record<string, string> = {
      hiring: SignalType.HIRING,
      funding: SignalType.FUNDING,
      launch: SignalType.LAUNCH,
      tech_usage: SignalType.TECH_USAGE,
      pain: SignalType.PAIN,
      discussion: SignalType.PAIN,
    }
    return map[type] || SignalType.PAIN
  }

  private extractName(title: string, author?: string): string {
    if (author) return author.replace("@", "").split("@")[0]
    return title.replace(/[-|.].*/g, "").trim() || "Unknown"
  }
}

export default SocialAdapter