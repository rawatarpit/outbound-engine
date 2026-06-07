import { z } from "zod"
import { generateStructured } from "../../llm/ollama"
import pino from "pino"
import { isEnterpriseDomain, isEnterpriseDescription, isMediaDomain } from "../core/enterprise-filter"
import { assembleContext, type AgentContext } from "../harness/contextAssembler"
import type { BrandProfile } from "../../db/supabase"

const logger = pino({ level: "debug" })

const scoreSchema = z.object({
  relevance_score: z.number().min(0).max(100),
  urgency_score: z.number().min(0).max(100),
  fit_reason: z.string(),
  is_enterprise: z.boolean().catch(false),
})

export interface LLMScore {
  relevance_score: number
  urgency_score: number
  fit_reason: string
  is_enterprise: boolean
}

export async function scoreCompany(
  companyName: string,
  domain: string,
  description: string,
  brandName: string,
  brandOffer: string,
  brandAudience: string,
  brand: BrandProfile,
  clientId?: string,
  ragContext?: string
): Promise<LLMScore | null> {
  if (isEnterpriseDomain(domain)) {
    return {
      relevance_score: 0,
      urgency_score: 0,
      fit_reason: "Enterprise domain rejected",
      is_enterprise: true,
    }
  }

  if (isMediaDomain(domain)) {
    return {
      relevance_score: 0,
      urgency_score: 0,
      fit_reason: "Media/publisher domain rejected",
      is_enterprise: false,
    }
  }

  const desc = description || companyName
  if (isEnterpriseDescription(desc)) {
    return {
      relevance_score: 0,
      urgency_score: 0,
      fit_reason: "Enterprise description detected",
      is_enterprise: true,
    }
  }

  /* =============================
     BUILD CONTEXT HARNESS
  ============================= */
  const contextInput = {
    company: {
      id: "",
      name: companyName,
      domain: domain || null,
      brand_id: "" // We'll get this from brand lookup in caller
    },
    brand: {
      id: "",
      brand_name: brandName,
      product: brandOffer,
      positioning: "",
      core_offer: brandOffer,
      audience: brandAudience,
      is_active: true,
      is_paused: false,
      discovery_enabled: true,
      outbound_enabled: true
    } as BrandProfile,
    intentId: undefined,
    stage: "scoring" as const
  };

  const agentContext = await assembleContext(contextInput);

  // Build context harness preamble
  let contextPreamble = "";
  if (agentContext.sourcePerformance.length > 0 || agentContext.pastOutcomes.length > 0) {
    contextPreamble = "CONTEXT FROM PAST PERFORMANCE AND CONVERSION PATTERNS:\n";
    
    if (agentContext.sourcePerformance.length > 0) {
      const sources = agentContext.sourcePerformance.slice(0, 3).map(s => 
        `- ${s.source}: ${s.sends} sends, ${s.replies} replies (${s.conversionRate.toFixed(1)}% conversion)`
      ).join('\n');
      contextPreamble += `Source Performance:\n${sources}\n\n`;
    }
    
    if (agentContext.pastOutcomes.length > 0) {
      const outcomes = agentContext.pastOutcomes.map(o => 
        `- ${o.type}: ${o.count} companies (avg score: ${o.avgScore})`
      ).join('\n');
      contextPreamble += `Past Scoring Outcomes:\n${outcomes}\n\n`;
    }
    
    if (agentContext.conversionPatterns.length > 0) {
      contextPreamble += `Conversion Patterns:\n${agentContext.conversionPatterns.join('\n')}\n\n`;
    }
  }

  const ragBlock = ragContext ? `\nSearch Context: ${ragContext}\n` : ""
  const prompt = `${contextPreamble}${ragBlock}Score how well this company fits as a customer for our product.

Company: ${companyName}
Domain: ${domain}
Description: ${description.slice(0, 1000)}

Our Product: ${brandOffer}
Target Audience: ${brandAudience}
Brand: ${brandName}${ragBlock}

CRITICAL RULES:
- Score 0 ONLY for DIRECT competitors: companies that build outbound sales automation, lead generation platforms, cold email infrastructure, or sales engagement tools (Outreach, Salesloft, Lemlist, etc.). These build what we build.
- Score HIGH for any B2B SaaS company, product company, or startup that needs to FIND and CONTACT other businesses. Almost any company selling to other businesses is a potential customer.
- Do NOT score 0 just because a company builds software tools, platforms, or even "AI agents" — most of them still need outbound sales to grow.
- Good targets: internal tool builders, dev tool companies, analytics platforms, infrastructure companies, VC firms, newsletter platforms, AI startups — literally anyone who sells B2B and needs lead generation.
- Score 0 for job portals, recruitment agencies, aggregators, staffing platforms (they don't buy outbound, they ARE outbound).

Return JSON:
- relevance_score: 0-100 how relevant this company is
- urgency_score: 0-100 how urgently they need our product
- fit_reason: short explanation
- is_enterprise: true if this is a very large company that wouldn't be a good fit`

  try {
    const result = await generateStructured(prompt, scoreSchema, 0, clientId, 400) as LLMScore
    logger.info({ company: companyName, score: result.relevance_score }, "LLM scoring completed")
    return result
  } catch (err: any) {
    logger.error({ error: err.message }, "LLM scoring failed")
    return null
  }
}

export async function batchScore(
  items: { company_name: string; domain: string; description: string }[],
  brandName: string,
  brandOffer: string,
  brandAudience: string,
  brand: BrandProfile,
  clientId?: string
): Promise<LLMScore[]> {
  const results: LLMScore[] = []
  for (const item of items) {
    const score = await scoreCompany(
      item.company_name, item.domain, item.description,
      brandName, brandOffer, brandAudience, brand, clientId
    )
    if (score) {
      results.push(score)
    }
  }
  return results
}
