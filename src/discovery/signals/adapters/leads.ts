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
}

// ============== AGENCY SIGNALS ==============

// Agencies looking for clients
async function fetchAgencyClients(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  // Reddit communities where agencies can find leads
  const subreddits = ["marketing", "digitalmarketing", "smallbusiness", "freelance", "entrepreneur"]
  for (const sub of subreddits.slice(0, 2)) {
    try {
      const url = `https://old.reddit.com/r/${sub}/search?q=${encodeURIComponent(query + " need marketing")}&sort=new`
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
      if (!response.ok) continue
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("div.search-result").each((i, el) => {
        if (i > 6) return
        const $el = $(el)
        const title = $el.find("a.search-title").text().trim()
        const href = $el.find("a.search-title").attr("href") || ""
        const snippet = $el.find("p.excerpt").text().trim().slice(0, 150)
        
        if (title) {
          results.push({ title, link: href, snippet, source: `reddit_${sub}` })
        }
      })
    } catch {}
  }
  
  return results
}

// Agencies looking for sponsors
async function fetchAgencySponsors(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  // Search for sponsorship opportunities
  const sponsorships = [
    { term: "sponsorship available", query: "event sponsorship" },
    { term: "looking for sponsors", query: "looking for sponsors" },
  ]
  
  for (const search of sponsorships) {
    try {
      const url = `https://old.reddit.com/r/startups/search?q=${encodeURIComponent(search.query)}&sort=new`
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
      if (!response.ok) continue
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("div.search-result").each((i, el) => {
        if (i > 5) return
        const $el = $(el)
        const title = $el.find("a.search-title").text().trim()
        const href = $el.find("a.search-title").attr("href") || ""
        
        if (title) {
          results.push({ title, link: href, snippet: search.term, source: "reddit_sponsor" })
        }
      })
    } catch {}
  }
  
  return results
}

// ============== PRODUCT/SAAS SIGNALS ==============

// Product growthseekers
async function fetchProductGrowth(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  const sources = [
    "producthunt.com",
    "indiehackers.com",
  ]
  
  for (const source of sources) {
    try {
      const url = `https://${source}/search?q=${encodeURIComponent(query)}`
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
      if (!response.ok) continue
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      const selector = source.includes("producthunt") 
        ? "h3[data-testid='product-name'], h3"
        : "a[href*='/post/'], h3"
      
      $(selector).each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.find("a").attr("href") || ""
        
        if (title && title.length > 2) {
          results.push({ 
            title, 
            link: href.startsWith("http") ? href : `https://${source}${href}`,
            snippet: `Searched for ${query}`,
            source: source.replace(".", "_") 
          })
        }
      })
    } catch {}
  }
  
  return results
}

// Product sponsors (podcasts, newsletters)
async function fetchProductSponsors(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  // Podcast sponsors
  try {
    const response = await fetch(`https://podchaser.com/search?q=${encodeURIComponent(query + " sponsor")}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("a[href*='/podcasts/'], h3 a").each((i, el) => {
        if (i > 6) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title) results.push({ title, link: href, snippet: "Podcast sponsor", source: "podcast" })
      })
    }
  } catch {}
  
  // Newsletter sponsors  
  try {
    const response = await fetch(`https://newsletterinspector.com/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("a[href*='/newsletter/'], h3").each((i, el) => {
        if (i > 6) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title) results.push({ title, link: href, snippet: "Newsletter", source: "newsletter" })
      })
    }
  } catch {}
  
  return results
}

// SaaS comparison searchers
async function fetchSaaSSearch(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  const reviewSites = ["g2.com", "capterra.com", "trustradius.com"]
  
  for (const site of reviewSites.slice(0, 2)) {
    try {
      const url = `https://www.${site}/search?q=${encodeURIComponent(query)}`
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
      if (!response.ok) continue
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("a[href*='/products/'], .product-name a").each((i, el) => {
        if (i > 6) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title) results.push({ 
          title, 
          link: `https://www.${site}${href}`,
          snippet: `Looking for ${query}`,
          source: "saas_review" 
        })
      })
    } catch {}
  }
  
  return results
}

// ============== EVENT SIGNALS ==============

// Event sponsors
async function fetchEventSponsors(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  // Meetup events looking for sponsors
  try {
    const response = await fetch(`https://www.meetup.com/find/?keywords=${encodeURIComponent(query + " sponsor")}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("a[href*='/'], .group-name").each((i, el) => {
        if (i > 6) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title) results.push({ 
          title, 
          link: href, 
          snippet: "Looking for sponsors",
          source: "meetup" 
        })
      })
    }
  } catch {}
  
  // Luma events
  try {
    const response = await fetch(`https://lu.ma/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("a[href*='/e/'], h3").each((i, el) => {
        if (i > 6) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title) results.push({ 
          title, 
          link: href, 
          snippet: "Event",
          source: "luma" 
        })
      })
    }
  } catch {}
  
  return results
}

// Event attendees
async function fetchEventAttendees(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  // Get upcoming events - attendees look for
  const eventTypes = ["conference", "summit", "meetup", "workshop"]
  
  for (const type of eventTypes.slice(0, 2)) {
    try {
      const url = `https://www.eventbrite.com/directory/${type}s/?q=${encodeURIComponent(query)}`
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
      if (!response.ok) continue
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("a[href*='/e/'], .event-card a").each((i, el) => {
        if (i > 6) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 3) {
          results.push({ 
            title, 
            link: href, 
            snippet: type,
            source: "eventbrite" 
          })
        }
      })
    } catch {}
  }
  
  return results
}

// ============== INFLUENCER SIGNALS ==============

// Influencer collabs
async function fetchInfluencerCollab(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  // Search for collab opportunities on Reddit
  try {
    const url = `https://old.reddit.com/r/influencers/search?q=${encodeURIComponent(query + " collab")}&sort=new`
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("div.search-result").each((i, el) => {
        if (i > 6) return
        const $el = $(el)
        const title = $el.find("a.search-title").text().trim()
        const href = $el.find("a.search-title").attr("href") || ""
        
        if (title) {
          results.push({ title, link: href, snippet: "Influencer collab", source: "reddit_influencer" })
        }
      })
    }
  } catch {}
  
  // YouTube collabs
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + " sponsorship collab")}`
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      
      $("#video-title").each((i, el) => {
        if (i > 4) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.find("a").attr("href") || ""
        if (title) {
          results.push({ 
            title, 
            link: href ? `https://youtube.com${href}` : "", 
            snippet: title, 
            source: "youtube" 
          })
        }
      })
    }
  } catch {}
  
  return results
}

// ============== STARTUP SIGNALS ==============

// Startup growthseekers
async function fetchStartupGrowth(query: string): Promise<LeadResult[]> {
  const results: LeadResult[] = []
  
  // Y Combinator, Indie Hackers - startups growing
  const sources = [
    "news.ycombinator.com",
    "www.indiehackers.com",
  ]
  
  for (const source of sources) {
    try {
      const url = `https://${source}/search?q=${encodeURIComponent(query + " growth")}`
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })
      if (!response.ok) continue
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      const selector = source.includes("ycombinator") ? "tr.athing a" : "a[href*='/post/']"
      
      $(selector).each((i, el) => {
        if (i > 6) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 5) {
          results.push({ 
            title, 
            link: href, 
            snippet: "Startup growth",
            source: "startup" 
          })
        }
      })
    } catch {}
  }
  
  return results
}

export class LeadAdapter extends DiscoveryAdapter {
  source = "lead_sources"
  supportedSignals = Object.values(SignalType)

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
        signal: params.signal,
      },
    }
  }

  private async executeSearch(query: string, signal: string): Promise<LeadResult[]> {
    const allResults: LeadResult[] = []

    // Run different searches based on signal type
    if (signal === "agency_looking_clients") {
      const [agencyClients] = await Promise.all([fetchAgencyClients(query)])
      allResults.push(...agencyClients)
    } else if (signal === "agency_looking_sponsors") {
      const [agencySponsors] = await Promise.all([fetchAgencySponsors(query)])
      allResults.push(...agencySponsors)
    } else if (signal === "product_growth" || signal === "saas_search") {
      const [productGrowth, saasSearch] = await Promise.all([fetchProductGrowth(query), fetchSaaSSearch(query)])
      allResults.push(...productGrowth, ...saasSearch)
    } else if (signal === "product_sponsors" || signal === "podcast_sponsors" || signal === "newsletter_sponsors") {
      const [sponsors] = await Promise.all([fetchProductSponsors(query)])
      allResults.push(...sponsors)
    } else if (signal === "event_sponsors") {
      const [eventSponsors] = await Promise.all([fetchEventSponsors(query)])
      allResults.push(...eventSponsors)
    } else if (signal === "event_attendees") {
      const [attendees] = await Promise.all([fetchEventAttendees(query)])
      allResults.push(...attendees)
    } else if (signal === "influencer_collab") {
      const [collab] = await Promise.all([fetchInfluencerCollab(query)])
      allResults.push(...collab)
    } else if (signal === "startup_growth") {
      const [startup] = await Promise.all([fetchStartupGrowth(query)])
      allResults.push(...startup)
    } else {
      // Default: run all
      const [clients, product, sponsors, events, startup] = await Promise.all([
        fetchAgencyClients(query),
        fetchProductGrowth(query),
        fetchProductSponsors(query),
        fetchEventSponsors(query),
        fetchStartupGrowth(query),
      ])
      allResults.push(...clients, ...product, ...sponsors, ...events, ...startup)
    }

    logger.info({ stage: "LEAD_SEARCH", signal, query, count: allResults.length })
    return allResults.slice(0, 30)
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as LeadResult[]
    logger.info({ stage: "LEAD_NORMALIZE", count: items.length })

    return items
      .filter((item) => item.title || item.link)
      .map((item) => {
        const domain = item.link ? this.extractDomain(item.link) : undefined
        return this.createOpportunity({
          name: domain || item.title.split(" ").slice(0, 4).join(" "),
          domain,
          source: item.source,
          signal: item.source,
          confidence: 0.75,
          metadata: { title: item.title, snippet: item.snippet, link: item.link },
        })
      })
  }
}

export default LeadAdapter