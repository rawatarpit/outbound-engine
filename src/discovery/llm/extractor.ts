import { z } from "zod"
import { generateStructured } from "../../llm/ollama"
import pino from "pino"
import { assembleContext, type AgentContext } from "../harness/contextAssembler"
import type { BrandProfile } from "../../db/supabase"

const logger = pino({ level: "debug" })

const classificationSchema = z.object({
  type: z.enum(["real_company", "job_posting", "aggregator", "noise", "news_article"]).default("noise"),
  company_name: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).default(0.3),
}).transform((data) => ({
  type: data.type,
  company_name: data.company_name || undefined,
  confidence: data.confidence,
}))

function sanitizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = raw.trim().toLowerCase()
  // Strip protocol
  d = d.replace(/^https?:\/\//, "")
  // Strip path, port, fragment, query (but not the domain's own dots)
  d = d.replace(/[/:#?].*$/, "")
  // Keep only valid domain characters
  d = d.replace(/[^a-z0-9.-]/g, "")
  // Must have at least one dot and valid TLD
  if (!/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null
  return d
}

const combinedSchema = z.object({
  type: z.enum(["real_company", "job_posting", "aggregator", "noise", "news_article"]).default("noise"),
  company_name: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  description: z.string().nullable().optional().transform((v) => v || ""),
  company_size: z.enum(["unknown", "small", "medium", "enterprise"]).nullable().optional().transform((v) => v || "unknown"),
  industry: z.string().nullable().optional().transform((v) => v || "unknown"),
  signal_evidence: z.string().nullable().optional().transform((v) => v || ""),
  job_title: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional().default(0),
})

export interface LLMClassification {
  type: "real_company" | "job_posting" | "aggregator" | "noise" | "news_article"
  company_name?: string
  confidence: number
}

export interface LLMExtraction {
  type: "real_company" | "job_posting" | "aggregator" | "noise" | "news_article"
  company_name: string
  domain: string | null
  linkedin_url: string | null
  description: string
  company_size: "unknown" | "small" | "medium" | "enterprise"
  industry: string
  signal_evidence: string
  job_title?: string
  confidence: number
}

// classifyContent() removed as dead code per TODO.md
// This function was unused and has been deleted

export async function extractCompanyInfo(
  title: string,
  text: string,
  source: string,
  company: { id: string; name?: string | null; domain?: string | null; brand_id?: string | null },
  brand: BrandProfile,
  clientId?: string,
  ragContext?: string
): Promise<LLMExtraction | null> {
  // Build context harness input
  const contextInput = {
    company: {
      id: company.id,
      name: company.name,
      domain: company.domain,
      brand_id: company.brand_id
    },
    brand,
    intentId: undefined, // Will be filled by caller if available
    stage: "discovery" as const
  }

  // Assemble context from harness
  const agentContext = await assembleContext(contextInput)
  
  // Build enhanced context with agent context information
  const contextBlocks = []
  
  if (agentContext.similarCompanies.length > 0) {
    const similar = agentContext.similarCompanies.slice(0, 3).map(c => 
      `- ${c.name} (${c.domain}): ${c.outcome} (similarity: ${(c.similarity * 100).toFixed(1)}%)`
    ).join('\n')
    contextBlocks.push(`Similar Companies:\n${similar}`)
  }
  
  if (agentContext.relevantIntents.length > 0) {
    const intents = agentContext.relevantIntents.slice(0, 3).map(i => 
      `- ${i.intent} (priority: ${i.priority}, conversion: ${(i.conversion_rate * 100).toFixed(1)}%)`
    ).join('\n')
    contextBlocks.push(`Relevant Intents:\n${intents}`)
  }
  
  if (agentContext.pastOutcomes.length > 0) {
    const outcomes = agentContext.pastOutcomes.map(o => 
      `- ${o.type}: ${o.count} companies (avg score: ${o.avgScore})`
    ).join('\n')
    contextBlocks.push(`Past Outcomes:\n${outcomes}`)
  }
  
  if (agentContext.sourcePerformance.length > 0) {
    const sources = agentContext.sourcePerformance.slice(0, 3).map(s => 
      `- ${s.source}: ${s.sends} sends, ${s.replies} replies (${s.conversionRate.toFixed(1)}% conversion)`
    ).join('\n')
    contextBlocks.push(`Source Performance:\n${sources}`)
  }
  
  if (agentContext.conversionPatterns.length > 0) {
    contextBlocks.push(`Conversion Patterns:\n${agentContext.conversionPatterns.join('\n')}`)
  }
  
  const enhancedContext = [...contextBlocks, ragContext || ""].filter(Boolean).join('\n\n')
  const ragBlock = enhancedContext ? `\nContext: ${enhancedContext}\n` : ""
  const prompt = `Analyze this content and determine if it's about a real company.

Title: ${title}
Content: ${text.slice(0, 2000)}
Source URL: ${source}${ragBlock}

First, classify the content type:
- "real_company" if this is an actual company's own website, blog, or announcement
- "news_article" if this is a news article, press release, or blog post ABOUT a company (e.g., on TechCrunch, Yahoo Finance, BusinessWire, etc.)
- "job_posting" if this is a job listing or hiring post for a specific company
- "aggregator" if it lists/aggregates multiple companies (directories, listicles, top-10 lists)
- "noise" if irrelevant, spam, or unclear

If type is "aggregator" or "noise", you ONLY need to set type and confidence (other fields can be null).
If type is "news_article", extract company_name but leave domain null unless explicitly stated in the article text.
If type is "real_company" or "job_posting", extract full company details.

For job_posting: the hiring company is NOT the job board domain. Extract the actual company posting the job.

Rules:
- NEVER invent a company name. Only extract if explicitly mentioned on the page or in the content.
- For the domain: ONLY extract if the company's website URL is explicitly written on the page (e.g., "visit us at iceotope.com"). Do NOT infer or construct a domain from the company name.
- If the page is a news article about a company, the domain should be null unless the article explicitly states the company's website URL in text.
- company_size: "small" (<50), "medium" (50-500), "enterprise" (500+), or "unknown"
- Extract job_title if this is a job posting.
- If this company builds or sells AI automation tools / AI agents as THEIR product, classify as "noise" — they are competitors, not potential customers.
- If the company name is unclear or ambiguous from the content, set company_name and domain to null.
- Generic/common words like "app", "tool", "platform", "service", "startup", "company" alone are NOT valid company names.

Return JSON:
- type: classification
- company_name: the company name (null for aggregator/news_article/noise)
- domain: the company's website domain (ONLY if explicitly mentioned, otherwise null)
- linkedin_url: the company's LinkedIn page URL (e.g., "https://linkedin.com/company/acmecorp"). You may infer this from the company name if not explicitly mentioned. Use format: linkedin.com/company/{company-name-in-lowercase-with-hyphens}. If the company name is too generic, leave null.
- description: what the company does
- company_size: size estimate
- industry: the company's industry
- signal_evidence: what text indicates a buying signal
- job_title: the job role/title if job posting (null otherwise)
- confidence: 0.0 to 1.0`

  try {
    const result = await generateStructured(prompt, combinedSchema, 0, clientId, 500) as any

    if (result.type === "aggregator" || result.type === "noise") {
      logger.info({ type: result.type, confidence: result.confidence }, "Content classified as non-company, skipping extraction")
      return null
    }

    const rawDomain = result.domain
    result.domain = sanitizeDomain(result.domain)

    logger.info(
      { company: result.company_name, domain: result.domain, rawDomain, job_title: result.job_title, from_job_board: result.type === "job_posting" },
      "LLM extraction completed"
    )

    if (!result.company_name) {
      logger.info({ company: result.company_name, domain: result.domain }, "Missing company name — rejecting")
      return null
    }

    // News articles without an explicit company domain are useless — skip them
    if (result.type === "news_article" && !result.domain) {
      logger.info({ company: result.company_name }, "News article without explicit company domain — skipping")
      return null
    }

    if (!result.domain) {
      logger.info({ company: result.company_name, rawDomain }, "LLM did not extract a domain — will rely on URL-derived domain")
    }

    return result as LLMExtraction
  } catch (err: any) {
    logger.error({ error: err.message }, "LLM extraction failed")
    return null
  }
}

export async function batchExtractCompanyInfo(
  items: {
    title: string
    text: string
    source: string
    companyName?: string
  }[],
  brand: BrandProfile,
  clientId?: string,
): Promise<(LLMExtraction | null)[]> {
  if (items.length === 0) return []

  const itemBlocks = items.map((item, i) => {
    const truncated = item.text.slice(0, 1500)
    return `[ITEM ${i + 1}]
Title: ${item.title}
Source: ${item.source}
Content: ${truncated}`
  }).join("\n\n")

  const prompt = `Analyze each item below and extract company information. Return a JSON array where each element corresponds to the item at that index.

For each item, classify:
- "real_company" if this is an actual company's own website, blog, or announcement
- "news_article" if this is a news article or press release ABOUT a company
- "job_posting" if this is a job listing for a specific company
- "aggregator" if it lists multiple companies (directories, listicles)
- "noise" if irrelevant or unclear

If type is "aggregator" or "noise", only set type and confidence (other fields null).
If type is "news_article", extract company_name but leave domain null unless explicitly stated.
If type is "real_company" or "job_posting", extract full details.

Rules:
- NEVER invent a company name or domain
- For domain: ONLY extract if explicitly written in the content
- company_size: "small" (<50), "medium" (50-500), "enterprise" (500+), "unknown"
- Extract job_title if this is a job posting
- If it builds/sells AI automation tools, classify as "noise" (they are competitors)
- Generic words like "app", "tool", "platform" alone are NOT valid company names

The agency that would serve these companies builds: ${brand.core_offer || "software products"}

Respond with a JSON array matching this schema for each item:
[
  {
    "type": "real_company|job_posting|aggregator|noise|news_article",
    "company_name": "string or null",
    "domain": "string or null (ONLY if explicitly mentioned)",
    "linkedin_url": "string or null",
    "description": "string or null",
    "company_size": "unknown|small|medium|enterprise",
    "industry": "string or null",
    "signal_evidence": "string or null",
    "job_title": "string or null",
    "confidence": 0.0 to 1.0
  }
]

Items to analyze:
${itemBlocks}`

  try {
    const batchSchema = z.array(z.object({
      type: z.enum(["real_company", "job_posting", "aggregator", "noise", "news_article"]).default("noise"),
      company_name: z.string().nullable().optional(),
      domain: z.string().nullable().optional(),
      linkedin_url: z.string().nullable().optional(),
      description: z.string().nullable().optional().transform(v => v || ""),
      company_size: z.enum(["unknown", "small", "medium", "enterprise"]).nullable().optional().transform(v => v || "unknown"),
      industry: z.string().nullable().optional().transform(v => v || "unknown"),
      signal_evidence: z.string().nullable().optional().transform(v => v || ""),
      job_title: z.string().nullable().optional(),
      confidence: z.number().min(0).max(1).nullable().optional().default(0),
    }))
    const results = await generateStructured(prompt, batchSchema, 0, clientId, 1200) as any[]

    return items.map((item, i) => {
      const result = results[i]
      if (!result) return null
      if (result.type === "aggregator" || result.type === "noise") return null

      let rawDomain = result.domain
      result.domain = sanitizeDomain(result.domain)

      if (!result.company_name) return null
      if (result.type === "news_article" && !result.domain) return null

      return {
        type: result.type,
        company_name: result.company_name,
        domain: result.domain,
        linkedin_url: result.linkedin_url || null,
        description: result.description || "",
        company_size: result.company_size || "unknown",
        industry: result.industry || "unknown",
        signal_evidence: result.signal_evidence || "",
        job_title: result.job_title || null,
        confidence: result.confidence || 0,
      } as LLMExtraction
    })
  } catch (err: any) {
    logger.error({ error: err.message }, "Batch extraction failed, falling back to individual extraction")
    const fallback: (LLMExtraction | null)[] = []
    for (const item of items) {
      const extracted = await extractCompanyInfo(
        item.title,
        item.text,
        item.source,
        { id: "", name: item.companyName, domain: null, brand_id: null },
        brand,
        clientId,
      )
      fallback.push(extracted)
    }
    return fallback
  }
}

export async function batchExtract(
  items: { 
    title: string; 
    text: string; 
    source: string;
    company?: { id: string; name?: string | null; domain?: string | null; brand_id?: string | null };
    brand?: any;
  }[],
  clientId?: string
): Promise<LLMExtraction[]> {
  const results: LLMExtraction[] = []
  for (const item of items) {
    const extracted = await extractCompanyInfo(
      item.title, 
      item.text, 
      item.source, 
      item.company || { id: "", name: null, domain: null, brand_id: null },
      item.brand || { id: "", brand_name: "", product: "", positioning: "", core_offer: "", audience: "", is_active: true, is_paused: false, discovery_enabled: true, outbound_enabled: true },
      clientId
    )
    if (extracted && extracted.confidence >= 0.3) {
      results.push(extracted)
    }
  }
  return results
}
