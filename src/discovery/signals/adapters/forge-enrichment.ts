import pino from "pino"
import { z } from "zod"
import { scrapeUrl } from "../../../core/utils/scraper"
import { generateStructured } from "../../../llm/ollama"
import type { DiscoveryResult, DiscoveryCompany } from "../../types"
import { DiscoveryRisk } from "../../types"

const logger = pino({ level: "debug" })

export interface ForgeEnrichConfig {
  company_name: string
  domain: string
  intent_id: string
  signal: string
  clientId?: string
}

const enrichmentSchema = z.object({
  industry: z.string().nullable(),
  sub_industry: z.string().nullable(),
  tech_stack: z.array(z.string()).nullable(),
  description: z.string().nullable(),
  employees_min: z.number().nullable(),
  employees_max: z.number().nullable(),
  revenue_range: z.string().nullable(),
  social_links: z.array(z.string()).nullable(),
  emails_found: z.array(z.object({
    email: z.string(),
    source: z.string(),
    confidence: z.number().min(0).max(1),
  })).nullable(),
})

const TECH_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "WordPress", pattern: /wp-content|wp-includes|wordpress/i },
  { name: "Shopify", pattern: /shopify|myshopify/i },
  { name: "React", pattern: /react\.js|react-dom|create-react-app|next\.js/i },
  { name: "Vue.js", pattern: /vue\.js|vuejs/i },
  { name: "Angular", pattern: /angular\.js|ng-app/i },
  { name: "Next.js", pattern: /next\.js|_next\/static/i },
  { name: "Node.js", pattern: /node\.js|express/i },
  { name: "Python/Django", pattern: /django|python|flask/i },
  { name: "Ruby/Rails", pattern: /ruby\s+on\s+rails|rails|\.ruby/i },
  { name: "PHP", pattern: /\.php|laravel|symfony/i },
  { name: "Stripe", pattern: /stripe\.com|stripe\.js/i },
  { name: "Intercom", pattern: /intercom\.io|intercom/i },
  { name: "Google Analytics", pattern: /google-analytics|ga\.js|gtag/i },
  { name: "HubSpot", pattern: /hubspot|hs-scripts/i },
  { name: "Salesforce", pattern: /salesforce|sfdc/i },
  { name: "Cloudflare", pattern: /cloudflare|cf-ray/i },
  { name: "AWS", pattern: /amazonaws\.com|aws\.amazon/i },
  { name: "Vercel", pattern: /vercel\.com|vercel/i },
  { name: "Netlify", pattern: /netlify\.com|netlify/i },
  { name: "Tailwind CSS", pattern: /tailwindcss|tw-/i },
  { name: "Bootstrap", pattern: /bootstrap\.css|bootstrap-/i },
]

function detectTechStack(html: string): string[] {
  const found: string[] = []
  for (const tech of TECH_PATTERNS) {
    if (tech.pattern.test(html)) {
      found.push(tech.name)
    }
  }
  return [...new Set(found)]
}

function extractEmails(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  const matches = text.match(emailRegex)
  if (!matches) return []

  // Filter out common non-business emails and deduplicate
  const ignorePatterns = [/\.png$/, /\.jpg$/, /\.svg$/, /\.css$/, /\.js$/]
  return [...new Set(matches.filter(e => !ignorePatterns.some(p => p.test(e))))]
}

export async function forgeEnrichmentAdapter(
  config: ForgeEnrichConfig
): Promise<DiscoveryResult> {
  const { company_name, domain, intent_id, signal, clientId } = config

  try {
    const urlsToTry = [
      `https://${domain}`,
      `https://www.${domain}`,
      `http://${domain}`,
    ]

    let html: string | null = null
    let usedUrl = ""
    for (const url of urlsToTry) {
      html = await scrapeUrl(url, 15000)
      if (html) {
        usedUrl = url
        break
      }
    }

    if (!html) {
      logger.info({ company: company_name, domain }, "No website content found for enrichment")
      return { companies: [], contacts: [] }
    }

    // Extract text content for LLM analysis
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 6000)

    const techStack = detectTechStack(html)
    const rawEmails = extractEmails(html)

    let enrichment = {
      industry: null as string | null,
      sub_industry: null as string | null,
      description: textContent.substring(0, 500),
      employees_min: null as number | null,
      employees_max: null as number | null,
      revenue_range: null as string | null,
      tech_stack: techStack,
      social_links: [] as string[],
      emails_found: rawEmails.slice(0, 5).map(e => ({ email: e, source: "website", confidence: 0.5 })),
    }

    // LLM enrichment pass
    try {
      const prompt = `Analyze this company's website content and extract business intelligence.

Company: ${company_name}
Domain: ${domain}

Website Content:
${textContent.substring(0, 4000)}

Tech Stack Detected: ${techStack.join(", ") || "none detected"}
Emails Found: ${rawEmails.join(", ") || "none"}

Return structured data with:
- industry: the primary industry (e.g., "SaaS", "Fintech", "Healthcare", "Manufacturing", "E-commerce")
- sub_industry: more specific category (e.g., "CRM Software", "Payment Processing")
- description: 1-2 sentence company description
- employees_min: estimated minimum employee count (based on content hints, or null)
- employees_max: estimated maximum employee count (or null)
- revenue_range: estimated revenue range (e.g., "$1M-$10M", or null)
- social_links: any social media links found (LinkedIn, Twitter, etc.)`

      const llmResult = await generateStructured(prompt, enrichmentSchema, 0, clientId, 400) as z.infer<typeof enrichmentSchema>

      enrichment = {
        ...enrichment,
        industry: llmResult.industry || enrichment.industry,
        sub_industry: llmResult.sub_industry || enrichment.sub_industry,
        description: llmResult.description || enrichment.description,
        employees_min: llmResult.employees_min,
        employees_max: llmResult.employees_max,
        revenue_range: llmResult.revenue_range,
        tech_stack: [...new Set([...techStack, ...(llmResult.tech_stack || [])])],
        social_links: llmResult.social_links || [],
        emails_found: [...(llmResult.emails_found?.map(e => ({ email: e.email, source: e.source || "llm", confidence: e.confidence || 0.3 })) || []), ...enrichment.emails_found]
          .filter((e, i, arr) => arr.findIndex(x => x.email === e.email) === i)
          .slice(0, 5),
      }
    } catch (err: any) {
      logger.warn({ company: company_name, error: err.message }, "LLM enrichment failed, using extracted data only")
    }

    const company: DiscoveryCompany = {
      source: "forge_enrichment",
      source_url: usedUrl,
      risk: DiscoveryRisk.MODERATE_PUBLIC,
      domain,
      name: company_name,
      summary: enrichment.description || company_name,
      signal_type: signal,
      relevance_score: 60,
      urgency_score: 30,
      fit_reason: `Enriched via web research: ${enrichment.industry || "unknown industry"}`,
      raw: {
        intent_id,
        signal,
        industry: enrichment.industry,
        sub_industry: enrichment.sub_industry,
        tech_stack: enrichment.tech_stack,
        employees_min: enrichment.employees_min,
        employees_max: enrichment.employees_max,
        revenue_range: enrichment.revenue_range,
        emails_found: enrichment.emails_found,
        social_links: enrichment.social_links,
      },
    } as unknown as DiscoveryCompany

    logger.info({
      company: company_name,
      domain,
      industry: enrichment.industry,
      tech_count: enrichment.tech_stack.length,
      emails: enrichment.emails_found.length,
    }, "Forge enrichment completed")

    return { companies: [company], contacts: [] }

  } catch (err: any) {
    logger.error({ company: company_name, domain, error: err.message }, "Forge enrichment failed")
    return { companies: [], contacts: [] }
  }
}
