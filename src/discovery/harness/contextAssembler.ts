import pino from "pino"
import { supabase, type BrandProfile, type BrandIntent } from "../../db/supabase"
import { embed } from "../rag/embedder"

const logger = pino({ level: "info" })

const SEED_COMPANIES = [
  { name: "Vercel", domain: "vercel.com", outcome: "ideal", description: "Platform engineering, needs AI integration infrastructure" },
  { name: "Retool", domain: "retool.com", outcome: "ideal", description: "Internal tools builder, needs automation" },
  { name: "Airbyte", domain: "airbyte.com", outcome: "ideal", description: "Data infrastructure, needs reliability engineering" },
]

interface ContextInput {
  company: { id: string; name?: string | null; domain?: string | null; brand_id?: string | null }
  brand: BrandProfile
  intentId?: string
  stage: "research" | "qualification" | "outreach" | "discovery" | "scoring" | "reply" | "negotiation"
}

export interface AgentContext {
  similarCompanies: { name: string; domain: string; outcome: string; similarity: number }[]
  relevantIntents: { intent: string; priority: number; conversion_rate: number }[]
  pastOutcomes: { type: string; count: number; avgScore: number }[]
  sourcePerformance: { source: string; sends: number; replies: number; bounces: number; conversionRate: number }[]
  enrichmentHistory: { domain: string; strategies: string[]; confidence: number }[]
  conversionPatterns: string[]
  compaction?: string
}

const EMPTY_CONTEXT: AgentContext = {
  similarCompanies: [],
  relevantIntents: [],
  pastOutcomes: [],
  sourcePerformance: [],
  enrichmentHistory: [],
  conversionPatterns: [],
}

export async function assembleContext(input: ContextInput): Promise<AgentContext> {
  try {
    const [similarCompanies, relevantIntents, pastOutcomes, sourcePerformance, enrichmentHistory] =
      await Promise.all([
        findSimilarCompanies(input),
        findRelevantIntents(input),
        findPastOutcomes(input),
        findSourcePerformance(input),
        findEnrichmentHistory(input),
      ])

    const conversionPatterns = extractConversionPatterns(pastOutcomes, sourcePerformance)
    const compaction = await buildCompaction(input)

    let finalSimilarCompanies = similarCompanies
    if (finalSimilarCompanies.length === 0) {
      finalSimilarCompanies = SEED_COMPANIES.map(c => ({
        name: c.name,
        domain: c.domain,
        outcome: c.outcome,
        similarity: 0.85,
      }))
    }

    return {
      similarCompanies: finalSimilarCompanies,
      relevantIntents,
      pastOutcomes,
      sourcePerformance,
      enrichmentHistory,
      conversionPatterns,
      compaction: compaction || undefined,
    }
  } catch (err: any) {
    logger.warn({ error: err.message }, "ContextAssembler failed, returning empty context")
    return EMPTY_CONTEXT
  }
}

async function buildCompaction(input: ContextInput): Promise<string> {
  const { stage, company } = input
  const blocks: string[] = []

  if (stage === "qualification" || stage === "outreach" || stage === "reply" || stage === "negotiation") {
    const { data: research } = await supabase
      .from("research")
      .select("*")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .maybeSingle()

    if (research) {
      blocks.push(`=== RESEARCH SUMMARY ===
Industry: ${research.industry}
Size: ${research.size_estimate}
Pain Points: ${research.pain_points}
Buying Signals: ${research.buying_signals}
Automation Maturity: ${research.automation_maturity}
Summary: ${research.summary}`)
    }
  }

  if (stage === "outreach" || stage === "reply" || stage === "negotiation") {
    const { data: qualification } = await supabase
      .from("qualification")
      .select("*")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .maybeSingle()

    if (qualification) {
      blocks.push(`=== QUALIFICATION ASSESSMENT ===
Fit Score: ${qualification.fit_score}/100
Reasoning: ${qualification.reasoning}
Confidence: ${qualification.confidence}`)
    }
  }

  if (stage === "reply" || stage === "negotiation") {
    const { data: outreach } = await supabase
      .from("outreach")
      .select("subject, body")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .maybeSingle()

    if (outreach) {
      blocks.push(`=== OUTREACH DRAFT SENT ===
Subject: ${outreach.subject}
Body: ${outreach.body}`)
    }
  }

  if (stage === "negotiation") {
    const { data: reply } = await supabase
      .from("replies")
      .select("raw_message, intent, sentiment")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .maybeSingle()

    if (reply) {
      blocks.push(`=== CLIENT REPLY ===
Intent: ${reply.intent}
Sentiment: ${reply.sentiment}
Message: ${reply.raw_message}`)
    }
  }

  return blocks.join("\n\n")
}

async function findSimilarCompanies(input: ContextInput) {
  if (!input.company.domain && !input.company.name) return []

  const searchText = input.company.domain || input.company.name || ""
  if (!searchText) return []

  try {
    const queryEmbedding = await embed(searchText)
    const embeddingStr = `[${queryEmbedding.join(",")}]`

    const { data } = await supabase.rpc("match_discovery_embeddings", {
      query_embedding: embeddingStr,
      match_threshold: 0.6,
      match_count: 5,
      filter_brand_id: input.brand.id,
    })

    if (!data) return []

    return (data as any[])
      .filter((r: any) => r.content_type === "reference_company" || r.content_type === "converted_lead" || r.content_type === "rejected_lead")
      .map((r: any) => ({
        name: r.content_text?.split("\n")[0]?.replace(/^(Company|Name):\s*/i, "") || "Unknown",
        domain: (r.metadata as any)?.domain || "",
        outcome: r.content_type === "converted_lead" ? "converted" : r.content_type === "rejected_lead" ? "rejected" : "reference",
        similarity: r.similarity || 0,
      }))
  } catch {
    return []
  }
}

async function findRelevantIntents(input: ContextInput) {
  const { data: intents } = await supabase
    .from("brand_intents")
    .select("id, intent, priority, conversion_rate, signals")
    .eq("brand_id", input.brand.id)
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(5)

  return (intents ?? []).map((i: any) => ({
    intent: i.intent,
    priority: i.priority,
    conversion_rate: i.conversion_rate ?? 0,
  }))
}

async function findPastOutcomes(input: ContextInput) {
  try {
    const { data } = await supabase
      .from("companies")
      .select("status, relevance_score")
      .eq("brand_id", input.brand.id)
      .in("status", ["closed_won", "rejected", "closed_lost"])
      .limit(100)

    if (!data || !data.length) return []

    const outcomes: Record<string, { count: number; totalScore: number }> = {}
    for (const row of data as any[]) {
      const key = row.status === "closed_won" ? "closed_won" : "rejected"
      if (!outcomes[key]) outcomes[key] = { count: 0, totalScore: 0 }
      outcomes[key].count++
      outcomes[key].totalScore += (row.relevance_score || 50)
    }

    return Object.entries(outcomes).map(([type, stats]) => ({
      type,
      count: stats.count,
      avgScore: Math.round(stats.totalScore / stats.count),
    }))
  } catch {
    return []
  }
}

async function findSourcePerformance(input: ContextInput) {
  try {
    const { data } = await supabase
      .from("signal_source_performance")
      .select("*")
      .eq("brand_id", input.brand.id)
      .limit(20)

    if (!data) return []

    return (data as any[]).map((s: any) => ({
      source: s.source_id || s.source_name || "unknown",
      sends: s.sends || 0,
      replies: s.replies || 0,
      bounces: s.bounces || 0,
      conversionRate: s.sends > 0 ? ((s.replies || 0) / s.sends) * 100 : 0,
    }))
  } catch {
    return []
  }
}

async function findEnrichmentHistory(input: ContextInput) {
  if (!input.company.domain) return []

  try {
    const { data } = await supabase
      .from("discovered_companies")
      .select("domain, enrichment_status, raw_payload")
      .eq("domain", input.company.domain)
      .eq("brand_id", input.brand.id)
      .limit(5)

    if (!data) return []

    return (data as any[]).map((d: any) => ({
      domain: d.domain,
      strategies: d.raw_payload?.enrichment_strategies || [],
      confidence: d.raw_payload?.enrichment_confidence || 0,
    }))
  } catch {
    return []
  }
}

function extractConversionPatterns(
  pastOutcomes: { type: string; count: number; avgScore: number }[],
  sourcePerformance: { source: string; conversionRate: number }[],
): string[] {
  const patterns: string[] = []

  const won = pastOutcomes.find(o => o.type === "closed_won")
  const rejected = pastOutcomes.find(o => o.type === "rejected")

  if (won && won.count > 0) {
    patterns.push(`Past conversion rate: ${won.count} won with avg score ${won.avgScore}`)
  }
  if (rejected && rejected.count > 0) {
    patterns.push(`Past rejection rate: ${rejected.count} rejected with avg score ${rejected.avgScore}`)
  }

  const bestSources = sourcePerformance
    .filter(s => s.conversionRate > 0)
    .sort((a, b) => b.conversionRate - a.conversionRate)
    .slice(0, 3)

  if (bestSources.length > 0) {
    patterns.push(`Top converting sources: ${bestSources.map(s => `${s.source} (${s.conversionRate.toFixed(1)}%)`).join(", ")}`)
  }

  return patterns
}
