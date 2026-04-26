import { DiscoveryAdapter, type AdapterParams, type FetchResult, type AdapterConfig } from "../adapter"
import { SignalType } from "../types"
import type { Opportunity } from "../types"
import pino from "pino"
import * as cheerio from "cheerio"

const logger = pino({ level: "info" })

interface ExtraResult {
  title: string
  link: string
  snippet: string
  source: string
}

// BuiltIn - startup database
async function fetchBuiltIn(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://builtin.com/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/companies/'], h3 a").each((i, el) => {
        if (i > 10) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: `https://builtin.com${href}`, snippet: "", source: "builtin" })
        }
      })
    }
  } catch {}
  return results
}

// Crunchbase (basic search)
async function fetchCrunchbase(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://www.crunchbase.com/discover/organizations/latest?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/organization/'], .name a").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: `https://www.crunchbase.com${href}`, snippet: "", source: "crunchbase" })
        }
      })
    }
  } catch {}
  return results
}

// StartupLi (LinkedIn alternative)
async function fetchStartupLi(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://startupli.ie/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/company/'], h3 a").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: href, snippet: "", source: "startupli" })
        }
      })
    }
  } catch {}
  return results
}

// Otta (job matching)
async function fetchOtta(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://otta.com/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/jobs/'], h3 a").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: `https://otta.com${href}`, snippet: "", source: "otta" })
        }
      })
    }
  } catch {}
  return results
}

// Teal (job hunt)
async function fetchTeal(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://www.teal.jobs/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/jobs/'], .job-title").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: href, snippet: "", source: "teal" })
        }
      })
    }
  } catch {}
  return results
}

// Laravel (job board)
async function fetchLaravelJobs(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://larajobs.com/?search=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/job/'], .job-title").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: `https://larajobs.com${href}`, snippet: "", source: "larajobs" })
        }
      })
    }
  } catch {}
  return results
}

// ReactJobs
async function fetchReactJobs(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://reactjobs.fyi/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/jobs/'], h3 a").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: href, snippet: "", source: "reactjobs" })
        }
      })
    }
  } catch {}
  return results
}

// RemoteOK (extra)
async function fetchRemoteOkExtra(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://remoteok.com/remote-${query.toLowerCase().replace(/\s+/g, "-")}-jobs`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("h2, h3, .job-title").each((i, el) => {
        if (i > 10) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.find("a").attr("href") || ""
        if (title && title.length > 3) {
          results.push({ title, link: href, snippet: "", source: "remoteok" })
        }
      })
    }
  } catch {}
  return results
}

//icorn - startup jobs
async function fetchicorn(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://${encodeURIComponent(query)}.icorn.com`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/jobs/'], h3").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.find("a").attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: href, snippet: "", source: "icorn" })
        }
      })
    }
  } catch {}
  return results
}

// HackerWeb
async function fetchHackerWeb(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://hackerweb.app/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/item/']").each((i, el) => {
        if (i > 10) return
        const $el = $(el)
        const title = $el.text().trim()
        if (title && title.length > 3) {
          results.push({ title, link: `https://hackerweb.app${$el.attr("href")}`, snippet: "", source: "hackerweb" })
        }
      })
    }
  } catch {}
  return results
}

// HackerEarth
async function fetchHackerEarth(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://www.hackerearth.com/developers/?search=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("h3 a, a[href*='/developer/']").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: href, snippet: "", source: "hackerearth" })
        }
      })
    }
  } catch {}
  return results
}

// TechNation
async function fetchTechNation(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://technation.io/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/company/'], h3 a").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: href, snippet: "", source: "technation" })
        }
      })
    }
  } catch {}
  return results
}

// Y Combinator Directory (extended)
async function fetchYCDirectory(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  const urls = [
    "https://www.ycombinator.com/companies/?q=",
    "https://news.ycombinator.com/",
  ]
  for (const baseUrl of urls) {
    try {
      const response = await fetch(`${baseUrl}${encodeURIComponent(query)}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      })
      if (!response.ok) continue
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/company/'], tr.athing a").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: href, snippet: "", source: "ycombinator" })
        }
      })
    } catch {}
  }
  return results
}

// Startup Pitch Database
async function fetchStartupPitch(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://www.startuppitch.co/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/pitch/'], h3 a").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2) {
          results.push({ title, link: href, snippet: "", source: "startuppitch" })
        }
      })
    }
  } catch {}
  return results
}

// BetaPage
async function fetchBetaPage(query: string): Promise<ExtraResult[]> {
  const results: ExtraResult[] = []
  try {
    const response = await fetch(`https://betapage.co/search?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)
      $("a[href*='/'], h3 a").each((i, el) => {
        if (i > 8) return
        const $el = $(el)
        const title = $el.text().trim()
        const href = $el.attr("href") || ""
        if (title && title.length > 2 && href?.includes("betapage")) {
          results.push({ title, link: href, snippet: "", source: "betapage" })
        }
      })
    }
  } catch {}
  return results
}

export class ExtraAdapter extends DiscoveryAdapter {
  source = "extra_sources"
  supportedSignals = Object.values(SignalType)

  constructor(config: AdapterConfig = {}) {
    super(config)
  }

  override supports(signal: string): boolean {
    return true
  }

  async fetch(params: AdapterParams): Promise<FetchResult> {
    const results = await this.executeSearch(params.query, params.signal)
    return { raw: results, metadata: { searchQuery: params.query, resultCount: results.length, source: "extra_sources" } }
  }

  private async executeSearch(query: string, signal: string): Promise<ExtraResult[]> {
    const allResults: ExtraResult[] = []

    // Parallel fetch for speed
    const [builtin, remoteok, yc, larajobs, reactjs, teal, otta] = await Promise.all([
      fetchBuiltIn(query),
      fetchRemoteOkExtra(query),
      fetchYCDirectory(query),
      fetchLaravelJobs(query),
      fetchReactJobs(query),
      fetchTeal(query),
      fetchOtta(query),
    ])

    allResults.push(...builtin, ...remoteok, ...yc, ...larajobs, ...reactjs, ...teal, ...otta)

    logger.info({ stage: "EXTRA_COMPLETE", query, count: allResults.length })
    return allResults.slice(0, 40)
  }

  normalize(raw: unknown[]): Opportunity[] {
    const items = raw as ExtraResult[]
    return items.filter(i => i.title).map(item => {
      const domain = this.extractDomain(item.link)
      return this.createOpportunity({
        name: domain || item.title.split(" ")[0],
        domain: domain || undefined,
        source: item.source,
        signal: item.source === "remoteok" ? SignalType.REMOTE_HIRING : SignalType.HIRING,
        confidence: 0.75,
        metadata: { title: item.title, url: item.link },
      })
    })
  }
}

export default ExtraAdapter