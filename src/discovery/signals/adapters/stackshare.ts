import pino from "pino"
import axios from "axios"
import { load } from "cheerio"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"
import { randomHeaders } from "../../utils/userAgent"
import { normalizeDomain } from "../../normalizer"
import { withRateLimit } from "../../utils/rate-limiter"

const logger = pino({ level: "debug" })

export interface StackShareAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
}

export async function stackshareAdapter(
  config: StackShareAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 15 } = config

  try {
    const url = query
      ? `https://stackshare.io/companies?q=${encodeURIComponent(query)}`
      : "https://stackshare.io/stacks"

    const rawResults: any[] = await withRateLimit("stackshare", async () => {
      const response = await axios.get(url, {
        headers: {
          ...randomHeaders(),
          "Accept": "text/html,application/xhtml+xml",
        },
        timeout: 15000,
      })

      const $ = load(response.data)
      const results: any[] = []
      const seen = new Set<string>()

      $('a[href*="/companies/"], a[href*="/company/"], [class*="company-card"], [class*="companyCard"], .company').each((_, el) => {
        const $el = $(el)
        const name = $el.find(".name, [class*='name'], h3, h4, .title, [class*='title']").first().text().trim() || $el.text().trim()
        if (!name || name.length < 2) return

        const cleanName = name.replace(/^\d+\s*/, "").trim()
        const key = cleanName.toLowerCase()
        if (seen.has(key) || cleanName.length < 2) return
        seen.add(key)

        const href = $el.attr("href")
        const companyUrl = $el.find('a[href^="http"]').first().attr("href") || ""
        const description = $el.find("p, .description, [class*='desc'], .tagline").first().text().trim()
        const domain = companyUrl ? normalizeDomain(companyUrl) : `${key.replace(/[^a-z0-9]/g, "")}.com`
        const toolCount = parseInt($el.find('[class*="tool"], [class*="stack"]').text().match(/\d+/)?.[0] || "0", 10)

        results.push({
          source: "stackshare",
          source_url: href ? `https://stackshare.io${href}` : url,
          risk: DiscoveryRisk.MODERATE_PUBLIC,
          domain,
          name: cleanName,
          title: cleanName,
          summary: description.substring(0, 300),
          signal_type: "tech_usage",
          relevance_score: toolCount > 5 ? 75 : 60,
          urgency_score: toolCount > 10 ? 55 : 40,
          fit_reason: `Company on StackShare matching "${query}" with ${toolCount} tools${description ? `: ${description.substring(0, 100)}` : ""}`,
          raw: { query, intent_id, signal, tool_count: toolCount, source: "stackshare_html" },
        })
      })

      return results
    })

    const limited = rawResults.slice(0, max_results)
    const companies: DiscoveryCompany[] = limited.map((c: any) => c as DiscoveryCompany)

    logger.info({ query, count: companies.length }, "StackShare adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "StackShare adapter failed")
    return { companies: [], contacts: [] }
  }
}
