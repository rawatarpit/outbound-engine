import pino from "pino"
import axios from "axios"
import { load } from "cheerio"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"
import { randomHeaders } from "../../utils/userAgent"
import { normalizeDomain } from "../../normalizer"
import { isMediaDomain, isEnterpriseDomain } from "../../core/enterprise-filter"

const logger = pino({ level: "debug" })

export interface TechCrunchAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
}

export async function techcrunchAdapter(
  config: TechCrunchAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 10 } = config

  try {
    const rssUrl = query
      ? `https://techcrunch.com/tag/${encodeURIComponent(query.replace(/\s+/g, '-'))}/feed/`
      : "https://techcrunch.com/feed/"

    const response = await axios.get(rssUrl, {
      headers: {
        ...randomHeaders(),
        "Accept": "application/rss+xml, application/xml, text/xml",
      },
      timeout: 10000,
    })

    const $ = load(response.data, { xmlMode: true })
    const articles: { title: string; link: string; description: string; pubDate: string }[] = []

    $("item").each((i, el) => {
      if (i >= max_results * 2) return false
      articles.push({
        title: $(el).find("title").text().trim(),
        link: $(el).find("link").text().trim(),
        description: $(el).find("description").text().trim(),
        pubDate: $(el).find("pubDate").text().trim(),
      })
    })

    const rawResults: any[] = []

    for (const article of articles) {
      const fullText = `${article.title} ${article.description}`
      const fundingMatch = fullText.match(/(\w+)\s+(raises|secured|gets|lands|closes)\s+\$[\d.,]+\s*(M|million|billion)/i)
      const acquisitionMatch = fullText.match(/(\w+)\s+(acquires|buys|purchases)\s+\w+/i)
      const companyMatch = fundingMatch || acquisitionMatch

      if (!companyMatch) continue

      const companyName = companyMatch[1]
      if (!companyName || companyName.length < 2) continue

      const domainMatch = fullText.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.(?:com|io|ai|co|app|dev|tech|org))\b/i)
      let domain = domainMatch ? normalizeDomain(domainMatch[0]) : null

      if (domain && isMediaDomain(domain)) {
        domain = `${companyName.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`
      }

      if (domain && isEnterpriseDomain(domain)) continue

      rawResults.push({
        source: "techcrunch",
        source_url: article.link,
        risk: DiscoveryRisk.MODERATE_PUBLIC,
        domain: domain || "unknown.com",
        name: companyName,
        title: companyName,
        summary: article.title.substring(0, 200),
        signal_type: fundingMatch ? "funding" : "growth_activity",
        relevance_score: 80,
        urgency_score: 60,
        fit_reason: `TechCrunch: ${fundingMatch ? "Funding" : "Acquisition"} — ${article.title.substring(0, 150)}`,
        raw: { query, intent_id, signal, article_title: article.title, article_url: article.link },
      })
    }

    const limited = rawResults.slice(0, max_results)
    const companies: DiscoveryCompany[] = limited.map((c: any) => c as DiscoveryCompany)

    logger.info({ query, count: companies.length }, "TechCrunch adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "TechCrunch adapter failed")
    return { companies: [], contacts: [] }
  }
}
