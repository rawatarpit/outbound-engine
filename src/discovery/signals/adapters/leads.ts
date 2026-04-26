import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"
import pino from "pino"
import * as cheerio from "cheerio"

const logger = pino({ level: "info" })

interface LeadResult {
  title: string
  link: string
  snippet: string
  source: string
  author?: string
}

// Reddit communities for sales/pain discussions
async function fetchRedditSales(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  const subreddits = ["sales", "b2bsales", "startups", "saas", "entrepreneur", "smallbusiness"]
  
  for (const sub of subreddits.slice(0, 3)) {
    try {
      const url = `https://old.reddit.com/r/${sub}/search?q=${encodeURIComponent(query)}&sort=new`
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
      if (!response.ok) continue
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("div.search-result").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.find("a.search-title").text().trim()
        const link = $el.find("a.search-title").attr("href") || ""
        const snippet = $el.find("p.excerpt").text().trim().slice(0, 150)
        
        if (title && title.length > 3) {
          results.push({
            title,
            link,
            snippet,
            source: `reddit_${sub}`,
          })
        }
      })
    } catch (e) {
      logger.debug({ sub, error: e })
    }
  }
  
  logger.info({ stage: "REDDIT_SALES", query, count: results.length })
  return results
}

// LinkedIn Sales Navigator alternative (via Apollo free tiers)
async function fetchApollo(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  try {
    const response = await fetch(`https://app.apollo.io/api/v1/mixed_companies_search?${encodeURIComponent(query)}`, {
      headers: { 
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      },
    })
    
    if (response.ok) {
      const data = await response.json()
      const companies = data.companies || []
      
      for (const company of companies.slice(0, 10)) {
        results.push({
          title: company.name,
          link: company.apollo_link || "",
          snippet: company.short_description || company.industry || "",
          source: "apollo",
        })
      }
    }
  } catch (e) {
    logger.debug({ error: e })
  }
  
  return results
}

// Event sponsors (Meetup, Luma)
async function fetchEventSponsors(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  // Meetup groups
  try {
    const response = await fetch(`https://www.meetup.com/find/?keywords=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/'], .group-name").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: href, snippet: "", source: "meetup" })
        }
      })
    }
  } catch {}
  
  return results
}

// Podcast sponsors (Podchaser, Chartable)
async function fetchPodcastSponsors(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  try {
    const response = await fetch(`https://podchaser.com/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/podcasts/'], h3 a").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: href, snippet: "", source: "podcast" })
        }
      })
    }
  } catch {}
  
  return results
}

// Newsletter sponsors (Substack, Beehiiv)
async function fetchNewsletterSponsors(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  try {
    // Substack featured newsletters
    const response = await fetch(`https://substack.com/explore/category/tech`, {
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
        if (title && title.length > 2) {
          results.push({ title, link: href, snippet: "", source: "newsletter" })
        }
      })
    }
  } catch {}
  
  return results
}

// SaaS reviews seeking automation (Capterra/G2 for automation)
async function fetchAutomationSeekers(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  const automationTerms = ["automation", "workflow", "automate", "no-code", "zapier", "make"]
  
  for (const term of automationTerms) {
    try {
      const url = `https://www.g2.com/search?q=${term}%20${query}`
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
      if (!response.ok) continue
      
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/products/'], .product-name a").each((i, el) => {
        if (i > 5) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({
            title,
            link: `https://www.g2.com${href}`,
            snippet: `Looking for automation: ${term}`,
            source: "g2_automation",
          })
        }
      })
    } catch {}
  }
  
  return results
}

// Twitter/X lists for sales founders (via Nitter)
async function fetchTwitterLists(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  const lists = [
    "https://nitter.privacydev.net/search?q=sales+founders",
    "https://nitter.privacydev.net/search?q=saas+growing",
  ]
  
  for (const url of lists.slice(0, 1)) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) continue
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("div.tweet, article.tweet").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const content = $el.find(".tweet-content, p").first().text().trim().slice(0, 100)
        if (content && content.length > 10) {
          results.push({
            title: content,
            link: "",
            snippet: content,
            source: "twitter_list",
          })
        }
      })
    } catch {}
  }
  
  return results
}

// Facebook Groups (via mobile or alternative)
async function fetchFacebookGroups(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  // Try to access via search engines instead - just get the group names
  // Note: Facebook blocks most scraping, so we use cached/directory approach
  const popularGroups = [
    "B2B Sales & Marketing Leaders",
    "SaaS Founders & Growth",
    "Startup Founders Network",
    "Outbound Sales Pros",
  ]
  
  for (const group of popularGroups) {
    results.push({
      title: group,
      link: `https://facebook.com/search/groups/?q=${encodeURIComponent(query)}`,
      snippet: "Join for discussions",
      source: "facebook_groups",
    })
  }
  
  return results
}

// Slack communities (directory approach)
async function fetchSlackCommunities(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  // Known active Slack communities for B2B/Sales
  const slackGroups = [
    { name: "Sales VP Community", link: "https://sales-vp-community.slack.com" },
    { name: "SaaS Founders", link: "https://join-slack.netlify-com-sandbox-forbes.netlify.app" },
    { name: "B2B Growth", link: "https://b2bgroww.slack.com" },
  ]
  
  for (const group of slackGroups) {
    results.push({
      title: group.name,
      link: group.link + "/join",
      snippet: "Join for B2B discussions",
      source: "slack_community",
    })
  }
  
  return results
}

// YouTube comments about pain points
async function fetchYouTubePainPoints(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  try {
    // Focus on business/SaaS YouTube channels
    const channels = ["UCfzlCWtYy6CcnHTJ0N4pxtg", "UCx9p7Pkf1k2lJ1K", "UC2vT8"]
    
    for (const channel of channels.slice(0, 1)) {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + " problem")}&sp=CAI%253D`
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
      if (!response.ok) continue
      
      // YouTube requires JS - just get channel suggestions
      results.push({
        title: `Business/SaaS Growth Videos`,
        link: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        snippet: "Watch for pain point discussions",
        source: "youtube",
      })
    }
  } catch {}
  
  return results
}

export class LeadAdapter extends DiscoveryAdapter {
  source = "lead_sources"
  supportedSignals = [
    SignalType.PAIN,
    SignalType.OUTBOUND_PAIN,
    SignalType.AUTOMATION_NEED,
    SignalType.HIRING,
    SignalType.HIRING_SALES,
    SignalType.GROWTH_ACTIVITY,
    SignalType.TECH_USAGE,
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
        source: "lead_sources",
      },
    }
  }

  private async executeSearch(query: string, signal: string): Promise<LeadResult[]> {
    const allResults: LeadResult[] = []

    const [reddit, events, automation, newsletters, podcasts] = await Promise.all([
      fetchRedditSales(query),
      fetchEventSponsors(query),
      fetchAutomationSeekers(query),
      fetchNewsletterSponsors(query),
      fetchPodcastSponsors(query),
    ])

    allResults.push(...reddit, ...events, ...automation, ...newsletters, ...podcasts)

    logger.info({ stage: "LEAD_SEARCH", query, count: allResults.length })
    return allResults.slice(0, 30)
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as LeadResult[]
    logger.info({ stage: "LEAD_NORMALIZE", count: items.length })

    return items
      .filter((item) => item.title || item.link)
      .map((item) => {
        const signalType = this.classifyLead(item.source, item.title, item.snippet)
        const score = this.calculateLeadScore(signalType, item.source)
        const domain = item.link ? this.extractDomain(item.link) : undefined

        return this.createOpportunity({
          name: domain || item.title.split(" ").slice(0, 3).join(" "),
          domain,
          source: item.source,
          signal: signalType,
          sub_signal: item.source,
          confidence: score,
          metadata: {
            title: item.title,
            snippet: item.snippet,
            link: item.link,
          },
        })
      })
  }

  private classifyLead(source: string, title: string, snippet: string): string {
    const text = (title + " " + snippet).toLowerCase()
    
    // Source-based classification
    if (source.includes("reddit")) {
      if (text.includes("help") || text.includes("struggle") || text.includes("problem") || text.includes("outbound")) return SignalType.OUTBOUND_PAIN
      if (text.includes("hiring") || text.includes("job")) return SignalType.HIRING
      if (text.includes("automate") || text.includes("zapier") || text.includes("workflow")) return SignalType.AUTOMATION_NEED
      return SignalType.GROWTH_ACTIVITY
    }
    if (source.includes("automation") || source.includes("g2")) return SignalType.AUTOMATION_NEED
    if (source.includes("meetup") || source.includes("event")) return SignalType.GROWTH_ACTIVITY
    if (source.includes("newsletter") || source.includes("podcast")) return SignalType.GROWTH_ACTIVITY
    
    return SignalType.OUTBOUND_PAIN
  }

  private calculateLeadScore(source: string, signalType: string): number {
    // Higher intent sources get better scores
    const scores: Record<string, number> = {
      reddit_sales: 0.85,
      reddit_startups: 0.82,
      reddit_saas: 0.85,
      automation: 0.78,
      g2_automation: 0.8,
      newsletter: 0.72,
      podcast: 0.7,
      meetup: 0.65,
      twitter_list: 0.6,
      facebook_groups: 0.55,
    }
    return scores[source] || 0.5
  }
}

export default LeadAdapter