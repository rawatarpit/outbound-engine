import pino from "pino"
import axios from "axios"
import { load } from "cheerio"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"
import { randomHeaders } from "../../utils/userAgent"
import { normalizeDomain } from "../../normalizer"
import { isEnterpriseDomain, isMediaDomain } from "../../core/enterprise-filter"
import { isAggregatorByDomain } from "../../utils/domain-validator"
import { withRateLimit } from "../../utils/rate-limiter"

const logger = pino({ level: "debug" })

export interface CrunchbaseAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
}

export async function crunchbaseAdapter(
  config: CrunchbaseAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 15 } = config

  try {
    const searchUrl = `https://www.crunchbase.com/discover/organization.companies?q=${encodeURIComponent(query)}`

    const rawResults: any[] = await withRateLimit("crunchbase", async () => {
      const response = await axios.get(searchUrl, {
        headers: randomHeaders(),
        timeout: 20000,
      })

      const $ = load(response.data)
      const results: any[] = []

      const jsonLdScripts = $('script[type="application/ld+json"]')
      jsonLdScripts.each((_, script) => {
        try {
          const text = $(script).html() || ""
          const parsed = JSON.parse(text)
          const items = Array.isArray(parsed) ? parsed : [parsed]
          for (const item of items) {
            if (item["@type"] === "Organization" || item["@type"] === "Corporation") {
              const name = item.name || ""
              const website = item.url || item.sameAs || ""
              const domain = website ? normalizeDomain(website) : null
              const description = item.description || ""

              if (name && domain && !isEnterpriseDomain(domain) && !isMediaDomain(domain) && !isAggregatorByDomain(domain)) {
                results.push({
                  source: "crunchbase",
                  source_url: item["@id"] || searchUrl,
                  risk: DiscoveryRisk.MODERATE_PUBLIC,
                  domain,
                  name,
                  title: name,
                  summary: description.substring(0, 500),
                  signal_type: signal,
                  relevance_score: 70,
                  urgency_score: 50,
                  fit_reason: `Funded company on Crunchbase matching "${query}": ${description.substring(0, 200)}`,
                  raw: { query, intent_id, signal, source: "crunchbase_jsonld" },
                })
              }
            }
          }
        } catch {}
      })

      if (results.length === 0) {
        $('a[href*="/organization/"]').each((_, el) => {
          const $el = $(el)
          const name = $el.find('[class*="name"], [class*="title"]').first().text().trim()
          if (!name || name.length < 2) return
          const href = $el.attr("href")
          if (href && !results.some((r: any) => r.name === name)) {
            results.push({
              source: "crunchbase",
              source_url: href.startsWith("http") ? href : `https://www.crunchbase.com${href}`,
              risk: DiscoveryRisk.MODERATE_PUBLIC,
              domain: "unknown.com",
              name,
              title: name,
              signal_type: signal,
              relevance_score: 65,
              urgency_score: 45,
              fit_reason: `Crunchbase listing matching "${query}"`,
              raw: { query, intent_id, signal, source: "crunchbase_html" },
            })
          }
        })
      }

      return results
    })

    const filtered = rawResults.filter((c: any) => {
      if (c.domain === "unknown.com") return true
      return !isEnterpriseDomain(c.domain) && !isMediaDomain(c.domain) && !isAggregatorByDomain(c.domain)
    })

    const limited = filtered.slice(0, max_results)
    const companies: DiscoveryCompany[] = limited.map((c: any) => c as DiscoveryCompany)

    logger.info({ query, found: rawResults.length, valid: companies.length }, "Crunchbase adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Crunchbase adapter failed")
    return { companies: [], contacts: [] }
  }
}
