import pino from "pino"
import { scrapeCompanyWebsite, deepCrawlCompany } from "./adapters/crawl4ai"
import { enrichCompanyViaForge } from "./adapters/forge"
import { generateStructured } from "../../llm/ollama"
import { z } from "zod"
import type { DiscoveryCompany } from "../types"
import { DiscoveryRisk } from "../types"

const logger = pino({ level: "info" })

const companyExtractSchema = z.object({
  name: z.string().nullish(),
  industry: z.string().nullish(),
  description: z.string().nullish(),
  tech_stack: z.array(z.string()).nullish(),
  employees: z.string().nullish(),
  funding: z.string().nullish(),
  key_people: z.array(z.object({
    name: z.string(),
    title: z.string(),
  })).nullish(),
})

export async function researchCompany(
  companyName: string,
  domain: string,
  signal: string,
  intentId: string,
  clientId?: string,
): Promise<DiscoveryCompany | null> {
  try {
    // Step 1: Scrape the company website via Crawl4AI
    const website = await scrapeCompanyWebsite(domain)
    if (!website.success || !website.markdown) {
      logger.info({ domain }, "No website content found — skipping")
      return null
    }

    // Step 2: Deep crawl key pages
    const pages = await deepCrawlCompany(domain)
    const allContent = [website.markdown, ...pages.map(p => p.markdown)]
      .filter(Boolean)
      .join("\n\n---\n\n")
      .substring(0, 12000)

    // Step 3: LLM extraction of company details (quick, best-effort)
    let extraction: z.infer<typeof companyExtractSchema> | null = null
    try {
      const prompt = `Extract company intelligence from the website content below.

Company: ${companyName}
Domain: ${domain}

Website Content:
${allContent.substring(0, 3000)}

Return structured data with company name, industry, description, tech stack, employee count, funding info, and key people (C-suite/VP/Directors). Only include information explicitly stated or strongly implied in the text.`

      extraction = await generateStructured(prompt, companyExtractSchema, 0, clientId, 300) as z.infer<typeof companyExtractSchema>
    } catch {
      logger.warn({ company: companyName }, "LLM extraction failed")
    }

    // Step 4: FORGE enrichment (parallel, best-effort)
    const forgeResult = await enrichCompanyViaForge(companyName, domain)

    const industry = extraction?.industry || forgeResult?.industry || null
    const techStack = [...new Set([
      ...(extraction?.tech_stack || []),
      ...(forgeResult?.tech_stack || []),
    ])]
    const description = extraction?.description || forgeResult?.summary || companyName

    const keyPeople = extraction?.key_people || []
    const emails = forgeResult?.emails || []

    const company: DiscoveryCompany = {
      source: "open_source_orchestrator",
      source_url: website.url,
      risk: DiscoveryRisk.SAFE_API,
      domain,
      name: extraction?.name || companyName,
      summary: description?.substring(0, 500) || companyName,
      signal_type: signal,
      relevance_score: 65,
      urgency_score: 35,
      fit_reason: `Researched via open-source tools: ${industry || "unknown industry"}`,
      raw: {
        intent_id: intentId,
        signal,
        industry,
        tech_stack: techStack,
        description,
        employees: extraction?.employees || forgeResult?.employees || null,
        funding: extraction?.funding || null,
        revenue: forgeResult?.revenue || null,
        key_people: keyPeople,
        emails,
        social_links: forgeResult?.social_links || [],
        crawl_pages: pages.length,
      },
    } as unknown as DiscoveryCompany

    logger.info({
      company: companyName,
      domain,
      industry,
      tech_count: techStack.length,
      people: keyPeople.length,
      emails: emails.length,
    }, "Open-source research completed")

    return company

  } catch (err: any) {
    logger.error({ company: companyName, domain, error: err.message }, "Open-source research failed")
    return null
  }
}

export async function batchResearch(
  companies: { name: string; domain: string }[],
  signal: string,
  intentId: string,
  clientId?: string,
): Promise<DiscoveryCompany[]> {
  const results: DiscoveryCompany[] = []

  for (const c of companies) {
    const company = await researchCompany(c.name, c.domain, signal, intentId, clientId)
    if (company) results.push(company)
  }

  logger.info({ total: companies.length, succeeded: results.length }, "Batch research completed")
  return results
}
