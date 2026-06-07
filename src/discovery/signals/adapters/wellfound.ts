import pino from "pino"
import axios from "axios"
import { load } from "cheerio"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"
import { randomHeaders } from "../../utils/userAgent"
import { normalizeDomain } from "../../normalizer"
import { withRateLimit } from "../../utils/rate-limiter"

const logger = pino({ level: "debug" })

export interface WellfoundAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
}

export async function wellfoundAdapter(
  config: WellfoundAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 20 } = config

  try {
    const searchUrl = `https://angel.co/companies?q=${encodeURIComponent(query)}`

    const rawResults: any[] = await withRateLimit("wellfound", async () => {
      const response = await axios.get(searchUrl, {
        headers: {
          ...randomHeaders(),
          "Accept": "text/html,application/xhtml+xml",
          "Referer": "https://angel.co/",
        },
        timeout: 15000,
      })

      const $ = load(response.data)
      const results: any[] = []
      const seenNames = new Set<string>()

      $("a[class*='startup'], a[class*='company'], .companyCard, [class*='company-card'], .startupCard, [class*='startup-card']").each((_, el) => {
        const $el = $(el)
        const name = $el.find(".name, [class*='name'], .title, [class*='title'], h3, h4").first().text().trim()
        if (!name || name.length < 2) return
        const key = name.toLowerCase()
        if (seenNames.has(key)) return
        seenNames.add(key)

        const href = $el.attr("href")
        const desc = $el.find(".description, [class*='desc'], .tagline, [class*='tagline'], p").first().text().trim()
        const websiteLink = $el.find('a[href^="http"]').first().attr("href")
        const domain = websiteLink ? normalizeDomain(websiteLink) : null

        results.push({
          source: "wellfound",
          source_url: href ? `https://angel.co${href}` : searchUrl,
          risk: DiscoveryRisk.MODERATE_PUBLIC,
          domain: domain || `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
          name,
          title: name,
          summary: desc.substring(0, 500),
          signal_type: signal,
          relevance_score: 70,
          urgency_score: 50,
          fit_reason: `Startup on Wellfound matching "${query}"`,
          raw: { query, intent_id, signal, source: "wellfound_html" },
        })
      })

      return results
    })

    const limited = rawResults.slice(0, max_results)
    const companies: DiscoveryCompany[] = limited.map((c: any) => c as DiscoveryCompany)

    logger.info({ query, count: companies.length }, "Wellfound adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Wellfound adapter failed")
    return { companies: [], contacts: [] }
  }
}
