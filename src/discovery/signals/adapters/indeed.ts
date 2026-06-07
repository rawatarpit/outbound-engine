import pino from "pino"
import axios from "axios"
import { load } from "cheerio"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"
import { domainResolver } from "../../utils/domain-resolver"
import { randomHeaders } from "../../utils/userAgent"
import { isJobBoardOrRecruiter } from "../../core/job-board-filter"

const logger = pino({ level: "debug" })

export interface IndeedAdapterConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
  location?: string
}

export async function indeedAdapter(
  config: IndeedAdapterConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 20, location = "" } = config

  try {
    const locParam = location ? `&l=${encodeURIComponent(location)}` : ""
    const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(query)}${locParam}&limit=${max_results}`

    const response = await axios.get(url, {
      headers: {
        ...randomHeaders(),
        "Accept": "text/html,application/xhtml+xml",
        "Referer": "https://www.indeed.com/",
      },
      timeout: 15000,
    })

    const $ = load(response.data)
    const rawCompanies: any[] = []
    const seen = new Set<string>()

    $('[data-company-name], .company_name, .companyName, [data-testid="company-name"]').each((_, el) => {
      const companyName = $(el).text().trim()
      if (!companyName || companyName.length < 2) return
      const key = companyName.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      rawCompanies.push({
        source: "indeed",
        source_url: url,
        risk: DiscoveryRisk.MODERATE_PUBLIC,
        domain: "unknown.com",
        name: companyName,
        title: companyName,
        signal_type: signal,
        relevance_score: 75,
        urgency_score: 60,
        fit_reason: `Hiring on Indeed: ${query}`,
        raw: { query, intent_id, signal, location },
      })
    })

    if (rawCompanies.length === 0) {
      $('a[data-tn-element="companyName"], .jobsearch-JobInfoHeader-company, div[class*="company"] a').each((_, el) => {
        const companyName = $(el).text().trim()
        if (!companyName || companyName.length < 2) return
        const key = companyName.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        rawCompanies.push({
          source: "indeed",
          source_url: url,
          risk: DiscoveryRisk.MODERATE_PUBLIC,
          domain: "unknown.com",
          name: companyName,
          title: companyName,
          signal_type: signal,
          relevance_score: 75,
          urgency_score: 60,
          fit_reason: `Hiring on Indeed: ${query}`,
          raw: { query, intent_id, signal, location },
        })
      })
    }

    for (const c of rawCompanies) {
      if (isJobBoardOrRecruiter("indeed.com", c.name)) continue
      const domain = await domainResolver.resolve(c.name)
      if (domain) {
        c.domain = domain
      }
    }

    const validCompanies = rawCompanies.filter((c: any) => !isJobBoardOrRecruiter(c.domain, c.name))
    const companies: DiscoveryCompany[] = validCompanies.map((c: any) => c as DiscoveryCompany)

    logger.info({ query, found: rawCompanies.length, valid: companies.length }, "Indeed adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Indeed adapter failed")
    return { companies: [], contacts: [] }
  }
}
