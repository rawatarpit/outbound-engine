import pino from "pino"
import { z } from "zod"
import { executeScraplingSearch } from "../../../core/utils/scrapling"
import { generateStructured } from "../../../llm/ollama"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "debug" })

export interface WebResearchConfig {
  query: string
  intent_id: string
  signal: string
  max_results?: number
  clientId?: string
}

const companyExtractSchema = z.object({
  is_company: z.boolean(),
  company_name: z.string().nullable(),
  domain: z.string().nullable(),
  description: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

async function extractCompanyFromResult(
  title: string,
  snippet: string,
  url: string,
): Promise<{ name: string; domain: string; description: string; confidence: number } | null> {
  try {
    const prompt = `Determine if this web search result is about a specific real company (not a blog post, listicle, forum thread, job board, or news article aggregating multiple companies).

Title: ${title}
Snippet: ${snippet.slice(0, 500)}
URL: ${url}

If this is about a specific real company, set is_company: true and extract:
- company_name: the company name
- domain: the company's website domain (not the search result domain, use null if unclear)
- description: what the company does (inferred from the snippet)
- confidence: 0.0-1.0 how sure you are

If this is a listicle ("top 10", "best tools"), blog post, news article about multiple companies, forum thread, job posting, or any non-company-specific content, set is_company: false`

    const result = await generateStructured(prompt, companyExtractSchema, 0, undefined, 300) as z.infer<typeof companyExtractSchema>

    if (!result.is_company || !result.company_name || result.confidence < 0.3) {
      return null
    }

    return {
      name: result.company_name,
      domain: result.domain || extractDomain(url),
      description: result.description || snippet.slice(0, 300),
      confidence: result.confidence,
    }
  } catch {
    return null
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "")
  } catch {
    return "unknown.com"
  }
}

export async function webResearchAdapter(
  config: WebResearchConfig
): Promise<DiscoveryResult> {
  const { query, intent_id, signal, max_results = 15, clientId } = config

  try {
    const results = await executeScraplingSearch(query, "google", max_results)

    if (results.length === 0) {
      logger.info({ query }, "No search results for web research")
      return { companies: [], contacts: [] }
    }

    const companies: DiscoveryCompany[] = []
    const seen = new Set<string>()

    for (const result of results) {
      const extracted = await extractCompanyFromResult(
        result.title || "",
        result.body || "",
        result.url || "",
      )
      if (!extracted) continue

      const key = extracted.domain !== "unknown.com" ? extracted.domain : extracted.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      companies.push({
        source: "web_research",
        source_url: result.url || "",
        risk: DiscoveryRisk.MODERATE_PUBLIC,
        domain: extracted.domain,
        name: extracted.name,
        title: result.title || "",
        summary: extracted.description,
        signal_type: signal,
        relevance_score: Math.round(extracted.confidence * 100),
        urgency_score: 30,
        fit_reason: `Discovered via web research: ${query}`,
        raw: { query, intent_id, signal, confidence: extracted.confidence },
      } as DiscoveryCompany)
    }

    logger.info({ query, found: companies.length, total: results.length }, "Web research adapter completed")
    return { companies, contacts: [] }

  } catch (err: any) {
    logger.error({ query, error: err.message }, "Web research adapter failed")
    return { companies: [], contacts: [] }
  }
}
