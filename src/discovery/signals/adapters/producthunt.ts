import pino from "pino"
import axios from "axios"
import { load } from "cheerio"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "debug" })

export interface PHAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
}

function makeCompany(fields: {
  name: string; url: string; domain: string; summary: string;
  signal: string; query: string; intent_id: string; tagline?: string;
}): DiscoveryCompany {
  const c: any = {
    source: "producthunt",
    source_url: fields.url,
    risk: DiscoveryRisk.MODERATE_PUBLIC,
    domain: fields.domain,
    name: fields.name,
    title: fields.name,
    summary: fields.summary,
    signal_type: fields.signal,
    relevance_score: 60,
    urgency_score: 30,
    fit_reason: `ProductHunt result: ${fields.query}`,
    raw: { query: fields.query, intent_id: fields.intent_id, signal: fields.signal, tagline: fields.tagline, source: "producthunt" },
  }
  return c as DiscoveryCompany
}

export async function producthuntAdapter(
  config: PHAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 10 } = config

  try {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !["site","the","and","for","with","that","are","you","our","www","com","or","not","but"].includes(w))

    const rssUrl = "https://www.producthunt.com/feed"
    const response = await axios.get(rssUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml",
      },
      timeout: 10000,
    })

    const $ = load(response.data, { xmlMode: true })
    const companies: DiscoveryCompany[] = []

    $("item").each((i, el) => {
      if (companies.length >= max_results) return false

      const $el = $(el)
      const title = $el.find("title").text().trim()
      const link = $el.find("link").text().trim()
      const description = $el.find("description").text().trim()

      if (!title || !link) return

      const matchesQuery = queryTerms.length === 0 || queryTerms.some(t =>
        title.toLowerCase().includes(t) || description.toLowerCase().includes(t)
      )
      if (!matchesQuery) return

      const [name, tagline] = title.includes(":") ? title.split(":").map(s => s.trim()) : [title, ""]
      const domain = link ? new URL(link).hostname.replace("www.", "") : "producthunt.com"

      companies.push(makeCompany({ name, url: link, domain, summary: tagline || description || name, signal, query, intent_id, tagline }))
    })

    if (companies.length > 0) {
      logger.info({ query, count: companies.length }, "ProductHunt adapter completed (RSS match)")
      return { companies, contacts: [] }
    }

    // RSS returned results but none matched keywords — return top items anyway
    const allItems: DiscoveryCompany[] = []
    $("item").each((i, el) => {
      if (allItems.length >= max_results) return false
      const $el = $(el)
      const title = $el.find("title").text().trim()
      const link = $el.find("link").text().trim()
      if (!title || !link) return
      const [name, tagline] = title.includes(":") ? title.split(":").map(s => s.trim()) : [title, ""]
      const domain = link ? new URL(link).hostname.replace("www.", "") : "producthunt.com"
      allItems.push(makeCompany({ name, url: link, domain, summary: tagline || name, signal, query, intent_id, tagline }))
    })
    if (allItems.length > 0) {
      logger.info({ query, count: allItems.length }, "ProductHunt adapter completed (RSS fallback)")
      return { companies: allItems, contacts: [] }
    }

    const searchUrl = `https://www.producthunt.com/search?q=${encodeURIComponent(query)}`
    const searchResp = await axios.get(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
      timeout: 10000,
    })

    const $2 = load(searchResp.data)
    const searchCompanies: DiscoveryCompany[] = []

    $2('a[href*="/posts/"]').each((i, el) => {
      if (searchCompanies.length >= max_results) return false

      const $el = $2(el)
      const name = $el.text().trim()
      const href = $el.attr("href")
      if (!name || !href || name.length < 2) return

      const fullUrl = href.startsWith("http") ? href : `https://www.producthunt.com${href}`
      searchCompanies.push(makeCompany({ name, url: fullUrl, domain: "producthunt.com", summary: name, signal, query, intent_id }))
    })

    logger.info({ query, count: searchCompanies.length }, "ProductHunt adapter completed (HTML fallback)")
    return { companies: searchCompanies, contacts: [] }
  } catch (err: any) {
    logger.error({ query, error: err.message }, "ProductHunt adapter failed")
    return { companies: [], contacts: [] }
  }
}
