import pino from "pino"
import { supabase, type BrandProfile, type BrandIntent, getBrandProfile } from "../../db/supabase"
import type { NormalizedOpportunity } from "../core/normalizer"
import type { BrandContext } from "../core/opportunity-matcher"
import { buildRAGQueries, syncAllBrandEmbeddings, vectorSearch, embed } from "../rag"
import type { RAGQuery, DiscoverySource } from "../rag/types"
import { discoverCompaniesBatch, enrichCompany, extractContentSeeds, discoverFromContentSeeds } from "../../core/utils/discoveryWorker"
import { scrapeUrl } from "../../core/utils/scraper"
import { extractCompanyInfo, batchExtractCompanyInfo } from "../llm/extractor"
import { scoreCompany, type LLMScore } from "../llm/scorer"

import { isEnterpriseDomain, isEnterpriseDescription, isMediaDomain } from "../core/enterprise-filter"
import { extractSignal, type Signal } from "../core/signal-extractor"
import { matchOpportunity } from "../core/opportunity-matcher"
import { runPreValidation } from "../core/pre-validation"
import { recordEndClientSignal, recordProviderSignal, recordFalsePositive } from "../utils/source-precision"
import { createCorrelationContext, getLogger, startTrace, endTrace, incrementMetric } from "../utils/tracing"
import { normalizeOpportunity } from "../core/normalizer"
import {
  domainHasEmail,
  isLikelyRealCompanyName,
  isAggregatorByName,
  isAggregatorByDomain,
} from "../utils/domain-validator"
import { domainResolver } from "../utils/domain-resolver"
import { adapterHealth } from "../utils/adapter-health"
import { resultCache } from "../utils/result-cache"
import { recordAdapterResult } from "../utils/feedback-loop"
import { addCompany, linkCompanies } from "../utils/company-graph"
import { recordLeadOutcome } from "../utils/churn-predictor"
import { discoverDecisionMakers, storeDiscoveredContacts, getCompanyIdByDomainAndBrand } from "../contacts"
import { isGenericEmail } from "../../enrichment/utils/email-validator"
import { isJobBoardOrRecruiter } from "../core/job-board-filter"

import { generateQueriesForIntent } from "./queryGeneration/queryGenerationAgent"
import { queryCache } from "./queryGeneration/queryCache"
import type { GeneratedQuery } from "./queryGeneration/schema"
import { createRunId, logAgentTurn } from "../../harness/observability"
import { withRetry } from "../../harness/errorHandling"
import { getAdapterTool, getAdapterToolsBySource } from "../../harness/adapterTools"

const logger = pino({ level: "info" })

const SIGNAL_ADAPTER_MAP: Record<string, string[]> = {
  hiring: ["hn_hiring", "indeed", "wellfound", "jobs", "search", "web_research", "reddit"],
  pain: ["reddit", "hackernews", "search", "web_research", "community", "pushshift"],
  funding: ["techcrunch", "crunchbase", "news", "search", "web_research"],
  automation_need: ["reddit", "hackernews", "search", "web_research", "pushshift", "community"],
  tech_usage: ["stackshare", "github", "search", "web_research"],
  growth_activity: ["yc", "producthunt", "news", "search", "web_research"],
  partnership: ["search", "news", "blogs"],
  outbound_pain: ["reddit", "hackernews", "community", "search"],
  expansion: ["news", "search", "techcrunch", "web_research"],
  migration: ["search", "reddit", "hackernews", "stackshare"],
  compliance: ["news", "search", "blogs"],
  burnout: ["reddit", "hackernews", "community", "jobs"],
}

let shuttingDown = false
let totalStored = 0

async function getBrandIntents(brandId: string): Promise<BrandIntent[]> {
  const { data, error } = await supabase
    .from("brand_intents")
    .select("*")
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .order("priority", { ascending: true })

  if (error) {
    logger.error({ error: error.message }, "Failed to fetch brand intents")
    return []
  }
  return (data ?? []) as BrandIntent[]
}

function getBrandKeywords(brand: BrandProfile): string[] {
  const textFields = [brand.product, brand.core_offer, brand.positioning, brand.audience]
    .filter(Boolean)
    .join(" ")

  const stopWords = new Set([
    "the", "and", "for", "with", "this", "that", "are", "you", "our", "we", "to",
    "in", "on", "at", "by", "is", "it", "of", "or", "be", "an", "as", "will",
    "do", "not", "but", "if", "from", "has", "have", "had", "what", "when",
    "where", "who", "which", "how", "all", "any", "can", "etc", "get", "your"
  ])

  return [...new Set(
    textFields
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
  )]
}

interface RawCompanyRecord {
  brand_id: string
  client_id?: string | null
  name: string
  domain: string
  website?: string | null
  source_name: string
  signal_type: string
  relevance_score?: number
  urgency_score?: number
  fit_reason?: string | null
  summary?: string | null
  enrichment_status: string
  error?: string | null
  raw_payload?: Record<string, unknown>
}

async function storeRawDiscoveries(records: RawCompanyRecord[]): Promise<void> {
  if (records.length === 0) return
  const CHUNK = 25
  let stored = 0
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK)
    const payload = chunk.map(r => ({
      brand_id: r.brand_id,
      client_id: r.client_id || null,
      name: r.name.substring(0, 255),
      domain: r.domain || `raw-${i}-${stored}.result`,
      website: r.website?.substring(0, 500) || null,
      source_name: r.source_name,
      signal_type: r.signal_type,
      relevance_score: r.relevance_score ?? null,
      urgency_score: r.urgency_score ?? null,
      fit_reason: r.fit_reason?.substring(0, 500) || null,
      summary: r.summary?.substring(0, 1000) || null,
      enrichment_status: r.enrichment_status,
      error: r.error || null,
      raw_payload: r.raw_payload || null,
      discovered_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from("discovered_companies").insert(payload)
    if (error) {
      logger.warn({ count: chunk.length, error: error.message?.substring(0,120) }, "storeRawDiscoveries chunk failed")
    } else {
      stored += chunk.length
    }
  }
  if (stored > 0) {
    logger.info({ stored, total: records.length }, "Phase 1 raw results stored")
  }
}

async function isDomainClaimedByOtherBrand(domain: string, brandId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("discovered_companies")
      .select("id")
      .eq("domain", domain)
      .neq("brand_id", brandId)
      .limit(1)
    if (error) return false
    return (data?.length ?? 0) > 0
  } catch {
    return false
  }
}

async function storeSignalOpportunity(
  opp: NormalizedOpportunity,
  brandId: string,
  intentId?: string,
  clientId?: string,
  enrichmentPayload?: Record<string, unknown>
): Promise<{ stored: boolean; companyId?: string }> {
  try {
    const domain = opp.domain && opp.domain !== "unknown.com"
      ? opp.domain
      : "unknown.com"

    const { data, error } = await supabase
      .from("discovered_companies")
      .upsert({
        brand_id: brandId,
        client_id: clientId,
        domain,
        name: (opp.company || opp.title || "Unknown").substring(0, 255),
        website: opp.url?.substring(0, 500) || null,
        signal_type: opp.signal_type,
        relevance_score: opp.relevance_score,
        urgency_score: opp.urgency_score,
        fit_reason: opp.fit_reason?.substring(0, 500) || null,
        summary: opp.summary?.substring(0, 1000) || null,
        source_name: opp.source,
        enrichment_status: "approved",
        requires_enrichment: true,
        raw_payload: {
          title: opp.title,
          url: opp.url,
          signal_type: opp.signal_type,
          relevance_score: opp.relevance_score,
          job_title: opp.job_title || null,
          linkedin_url: opp.linkedin_url || null,
          intent_id: intentId,
          ...(enrichmentPayload || {}),
        },
        discovered_at: new Date(opp.timestamp || Date.now()).toISOString()
      }, { onConflict: "brand_id,domain" })
      .select("id")
      .single()

    if (error) {
      logger.error({ error: error.message }, "Failed to store signal opportunity")
      return { stored: false }
    }

    return { stored: true, companyId: data?.id }
  } catch (err: any) {
    logger.error({ error: err.message }, "DB storage error")
    return { stored: false }
  }
}

async function discoverAndStoreContacts(
  brandId: string,
  companyId: string,
  domain: string,
  companyName: string,
  industry?: string,
  brandContext?: string,
  clientId?: string,
  linkedinUrl?: string
): Promise<number> {
  try {
    const contacts = await discoverDecisionMakers({
      companyName,
      domain,
      industry,
      brandContext,
      clientId,
      linkedinUrl,
    })

    if (contacts.contacts.length === 0) {
      logger.debug({ company: companyName }, "No contacts discovered")
      return 0
    }

    const validContacts = contacts.contacts.filter((c) => {
      if (c.email && isGenericEmail(c.email)) {
        logger.debug({ email: c.email, name: c.full_name }, "Filtered out generic email")
        return false
      }
      return true
    })

    if (validContacts.length === 0) {
      logger.debug({ company: companyName }, "No valid contacts after filtering")
      return 0
    }

    const stored = await storeDiscoveredContacts({
      brandId,
      discoveredCompanyId: companyId,
      contacts: validContacts,
      domain,
    })

    logger.info(
      { company: companyName, discovered: contacts.contacts.length, stored },
      "Contact discovery completed"
    )

    return stored
  } catch (err: any) {
    logger.error(
      { company: companyName, error: err.message },
      "Contact discovery failed"
    )
    return 0
  }
}

function computeCompositeScore(params: {
  keywordScore: { relevance_score: number; urgency_score: number; fit_reason: string }
  llmScore: { relevance_score: number; urgency_score: number; fit_reason: string; is_enterprise: boolean } | null
  domainQuality: number
  signalStrength: number
  extractionConfidence: number
  coldStart?: boolean
}): { compositeScore: number; shouldStore: boolean } {
  const { keywordScore, llmScore, domainQuality, signalStrength, extractionConfidence, coldStart } = params

  const kwRel = keywordScore.relevance_score / 100
  const llmRel = llmScore ? llmScore.relevance_score / 100 : 0

  const compositeScore =
    kwRel * 0.40 +
    llmRel * 0.30 +
    domainQuality * 0.10 +
    signalStrength * 0.10 +
    extractionConfidence * 0.10

  const compositeThreshold = coldStart ? 0.20 : 0.30
  const factorThreshold = coldStart ? 0.25 : 0.50

  const atLeastOneFactorHigh =
    kwRel > factorThreshold || llmRel > factorThreshold || domainQuality > factorThreshold || signalStrength > factorThreshold

  return {
    compositeScore: Math.round(compositeScore * 100),
    shouldStore: compositeScore > compositeThreshold && atLeastOneFactorHigh,
  }
}

export async function startSignalDiscovery(
  brandId?: string,
  maxQueries: number = 20
): Promise<NormalizedOpportunity[]> {
  const startTime = Date.now()
  const runId = createRunId("discovery")
  const leadYieldBySource: Record<string, number> = {}
  const phaseTimings: Record<string, number> = {}
  logger.info({ runId }, "[SIGNAL-DRIVEN] Starting signal-driven discovery with multi-phase execution")
  totalStored = 0

  const allOpportunities: NormalizedOpportunity[] = []

  try {
    let brands: BrandProfile[]

    if (brandId) {
      const brand = await getBrandProfile(brandId)
      brands = brand ? [brand] : []
    } else {
      const { data } = await supabase
        .from("brand_profiles")
        .select("*")
        .eq("is_active", true)
        .eq("discovery_enabled", true)
      brands = (data ?? []) as BrandProfile[]
    }

    if (brands.length === 0) {
      logger.warn("No active brands found for signal discovery")
      return allOpportunities
    }

    async function processBrand(brand: BrandProfile): Promise<void> {
      if (shuttingDown) return
      if (brand.is_paused) return

      const ctx = createCorrelationContext({ brandId: brand.id, component: "engine" })
      const log = getLogger(ctx)
      const traceId = startTrace(`discovery_${brand.id}`, ctx)
      log.info({ brand: brand.brand_name }, "Running signal discovery for brand")

      const intents = await getBrandIntents(brand.id)
      if (intents.length === 0) {
        logger.info({ brand: brand.brand_name }, "No intents configured, skipping")
        return
      }

      const keywords = getBrandKeywords(brand)

      const brandContext: BrandContext = {
        name: brand.brand_name || brand.product || "brand",
        industry: brand.product || undefined,
        keywords,
      }

      const clientId = (brand as any).client_id || undefined
      const coldStart = (brand as any).cold_start_mode !== false

      // ─────────────────────────────────────────────
      // PRE-PHASE 1: RAG search (one-time, shared across intents)
      // ─────────────────────────────────────────────
      const runId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`

      let ragSimilarIntents: { intent_text: string; signal: string; similarity: number }[] = []
      try {
        const brandContext = [brand.brand_name, brand.product, brand.audience, brand.positioning].filter(Boolean).join(". ")
        if (brandContext) {
          const queryEmbedding = await embed(brandContext, clientId)
          ragSimilarIntents = await vectorSearch(queryEmbedding, brand.id)
        }
      } catch (err: any) {
        logger.warn({ error: err.message }, "RAG search failed before query gen, continuing without context")
      }

      async function runPhase1Batch(queries: RAGQuery[]): Promise<{ query: RAGQuery; result: any }[]> {
        if (shuttingDown || queries.length === 0) return []
        const batchInput = queries.map(q => ({
          text: q.text,
          signal: q.signal,
          intentId: q.intent_id,
          source: q.source,
        }))
        try {
          const companies = await discoverCompaniesBatch(batchInput, 3, clientId)
          const bySource = new Map<string, { query: RAGQuery; companies: any[] }>()
          for (const q of queries) {
            bySource.set(`${q.source}:${q.intent_id}`, { query: q, companies: [] })
          }
          for (const c of companies) {
            const key = `${(c as any).source || "open_source_worker"}:${(c as any).raw?.intent_id || ""}`
            const bucket = bySource.get(key) || bySource.values().next().value
            if (bucket) bucket.companies.push(c)
          }
          return Array.from(bySource.values()).map(b => ({ query: b.query, result: { companies: b.companies } }))
        } catch (err: any) {
          logger.error({ error: err.message, count: queries.length }, "Phase 1 batch worker failed")
          return queries.map(q => ({ query: q, result: { companies: [] } }))
        }
      }

      // ─────────────────────────────────────────────
      // Per-intent pipeline: generate → discover → filter → enrich
      // ─────────────────────────────────────────────
      const contactQueue: {
        brandId: string; companyId: string; domain: string; name: string;
        summary: string; ragContext: string; clientId?: string; linkedinUrl?: string;
      }[] = []

      for (const intent of intents) {
        if (shuttingDown) break

        // Step 1: Generate queries (or load from cache)
        let intentQueries: GeneratedQuery[]
        if (queryCache.has(intent.id)) {
          logger.info(`[QueryGen] Cache hit for intent: ${intent.intent}`)
          intentQueries = queryCache.getAll(intent.id)
        } else {
          logger.info(`[QueryGen] Generating queries for: ${intent.intent}`)
          try {
            const output = await generateQueriesForIntent(intent, brand, ragSimilarIntents, clientId)
            queryCache.set(intent.id, runId, output)
            await supabase.from("discovery_query_log").insert(
              output.queries.map(q => ({
                brand_id: brand.id,
                intent_id: intent.id,
                intent_text: intent.intent,
                adapter: q.adapter,
                query: q.query,
                raw_count: 0,
                approved_count: 0,
                lead_count: 0,
                run_id: runId,
              }))
            )
            logger.info(
              `[QueryGen] Generated ${output.queries.length} queries for "${intent.intent}": ${output.queries.map(q => `[${q.adapter}:p${q.priority}] ${q.query}`).join(", ")}`
            )
            intentQueries = output.queries
          } catch (err) {
            logger.error({ error: err, intentId: intent.id }, "[QueryGen] Failed for intent")
            continue
          }
        }

        if (intentQueries.length === 0) continue

        // Step 2: Build RAGQuery[] for this intent
        // Prioritize diverse adapters: pick up to 2 search + 2 yc + 2 reddit + 1 jobs = 7 max
        const allQueries: RAGQuery[] = intentQueries.map(q => ({
          text: q.query,
          source: q.adapter as DiscoverySource,
          intent_id: intent.id,
          signal: q.expected_signal,
          rag_context: q.rationale,
        }))
        const seen = new Set<string>()
        const queries: RAGQuery[] = allQueries.filter(q => {
          if (seen.size >= 6) return false
          if (seen.has(q.source)) return false
          seen.add(q.source)
          return true
        })
        if (queries.length < 3) {
          // Fill up to 3 if not enough diverse adapters
          for (const q of allQueries) {
            if (queries.length >= 6) break
            if (!queries.find(x => x.text === q.text)) queries.push(q)
          }
        }

        // Step 3: Phase 1 — Broad search for this intent
        logger.info({ intent: intent.intent, queryCount: queries.length }, "Phase 1: Broad search for intent")

        const batchSize = Math.min(queries.length, 20)
        const queryBatches: RAGQuery[][] = []
        for (let i = 0; i < queries.length; i += batchSize) {
          queryBatches.push(queries.slice(i, i + batchSize))
        }
        const broadSearchResults = (await Promise.all(queryBatches.map(b => runPhase1Batch(b)))).flat()
        const phase1Results = broadSearchResults.filter((r): r is { query: RAGQuery; result: any } => r !== null)

        // Store raw results — resolve domain immediately so Phase 2 can match
        const rawRecords: RawCompanyRecord[] = []
        for (const { query, result } of phase1Results) {
          for (const company of result.companies || []) {
            let rawDomain = company.domain || ""
            if (!rawDomain || rawDomain === "unknown.com") {
              const resolved = await domainResolver.resolve(company.name || "Unknown")
              if (resolved) {
                rawDomain = resolved
                company.domain = resolved
              }
            }
            if (!rawDomain) rawDomain = `raw-${rawRecords.length + 1}.result`
            rawRecords.push({
              brand_id: brand.id,
              client_id: clientId,
              name: company.name || "Unknown",
              domain: rawDomain,
              website: company.source_url || null,
              source_name: query.source,
              signal_type: query.signal,
              enrichment_status: "raw",
              raw_payload: {
                query: query.text,
                intent_id: query.intent_id,
                title: company.title || null,
                url: company.source_url || null,
                summary: company.summary || null,
              },
            })
          }
        }
        await storeRawDiscoveries(rawRecords)
        logger.info({ intent: intent.intent, totalCandidates: rawRecords.length }, "Phase 1 broad search completed for intent")

        // Step 4: Phase 2 — Quick filter
        logger.info({ intent: intent.intent, count: phase1Results.length }, "Phase 2: Quick filter for intent")

        const phase2Candidates: {
          query: RAGQuery;
          company: any;
          signal: any;
          keywordScore: { relevance_score: number; urgency_score: number; fit_reason: string };
          domainQuality: number;
          signalStrength: number;
        }[] = []

        const phase2Rejected: RawCompanyRecord[] = []
        const keywordThreshold = coldStart ? 20 : 30

        for (const { query, result } of phase1Results) {
          if (shuttingDown) break
          for (const company of result.companies || []) {
            const companyNameRaw = company.name || "Unknown"
            const companySummary = company.summary || companyNameRaw
            const rejectIdx = () => phase2Rejected.length + 1

            if (isAggregatorByName(companyNameRaw)) {
              phase2Rejected.push({
                brand_id: brand.id, client_id: clientId, name: companyNameRaw,
                domain: `rejected-${rejectIdx()}.result`, website: company.source_url || null,
                source_name: query.source, signal_type: query.signal,
                enrichment_status: "rejected", error: "Aggregator name match",
                raw_payload: { title: company.title, url: company.source_url, summary: company.summary, query: query.text, intent_id: query.intent_id },
              })
              continue
            }
            if (company.domain && isAggregatorByDomain(company.domain.toLowerCase())) {
              phase2Rejected.push({
                brand_id: brand.id, client_id: clientId, name: companyNameRaw,
                domain: `rejected-${rejectIdx()}.result`, website: company.source_url || null,
                source_name: query.source, signal_type: query.signal,
                enrichment_status: "rejected", error: "Aggregator domain match",
                raw_payload: { title: company.title, url: company.source_url, summary: company.summary, query: query.text, intent_id: query.intent_id },
              })
              continue
            }
            if (company.domain && isJobBoardOrRecruiter(company.domain.toLowerCase(), companyNameRaw)) {
              phase2Rejected.push({
                brand_id: brand.id, client_id: clientId, name: companyNameRaw,
                domain: `rejected-${rejectIdx()}.result`, website: company.source_url || null,
                source_name: query.source, signal_type: query.signal,
                enrichment_status: "rejected", error: "Job board / recruiter domain",
                raw_payload: { title: company.title, url: company.source_url, summary: company.summary, query: query.text, intent_id: query.intent_id },
              })
              continue
            }
            if (company.domain && isEnterpriseDomain(company.domain)) {
              phase2Rejected.push({
                brand_id: brand.id, client_id: clientId, name: companyNameRaw,
                domain: `rejected-${rejectIdx()}.result`, website: company.source_url || null,
                source_name: query.source, signal_type: query.signal,
                enrichment_status: "rejected", error: "Enterprise domain",
                raw_payload: { title: company.title, url: company.source_url, summary: company.summary, query: query.text, intent_id: query.intent_id },
              })
              continue
            }
            if (company.domain && isMediaDomain(company.domain)) {
              phase2Rejected.push({
                brand_id: brand.id, client_id: clientId, name: companyNameRaw,
                domain: `rejected-${rejectIdx()}.result`, website: company.source_url || null,
                source_name: query.source, signal_type: query.signal,
                enrichment_status: "rejected", error: "Media/publisher domain",
                raw_payload: { title: company.title, url: company.source_url, summary: company.summary, query: query.text, intent_id: query.intent_id },
              })
              continue
            }
            if (!isLikelyRealCompanyName(companyNameRaw)) {
              phase2Rejected.push({
                brand_id: brand.id, client_id: clientId, name: companyNameRaw,
                domain: `rejected-${rejectIdx()}.result`, website: company.source_url || null,
                source_name: query.source, signal_type: query.signal,
                enrichment_status: "rejected", error: "Not a likely real company name",
                raw_payload: { title: company.title, url: company.source_url, summary: company.summary, query: query.text, intent_id: query.intent_id },
              })
              continue
            }

            const signal = extractSignal(companySummary, companyNameRaw)
            const preValidation = runPreValidation(companyNameRaw, company.domain, signal)
            if (!preValidation.passed) {
              phase2Rejected.push({
                brand_id: brand.id, client_id: clientId, name: companyNameRaw,
                domain: `rejected-${rejectIdx()}.result`, website: company.source_url || null,
                source_name: query.source, signal_type: query.signal,
                enrichment_status: "rejected", error: `Pre-validation: ${preValidation.rejectionReasons.join("; ")}`,
                raw_payload: { title: company.title, url: company.source_url, summary: company.summary, query: query.text, intent_id: query.intent_id, preValidation },
              })
              if (signal.intent === 'provider') {
                recordProviderSignal(query.source)
              } else {
                recordFalsePositive(query.source)
              }
              continue
            }
            if (signal.intent === 'seeker') {
              recordEndClientSignal(query.source)
            }
            const keywordScore = matchOpportunity(signal, brandContext)

            if (keywordScore.relevance_score < keywordThreshold) {
              phase2Rejected.push({
                brand_id: brand.id, client_id: clientId, name: companyNameRaw,
                domain: `rejected-${rejectIdx()}.result`, website: company.source_url || null,
                source_name: query.source, signal_type: query.signal,
                enrichment_status: "rejected", error: `Keyword relevance too low: ${keywordScore.relevance_score}`,
                raw_payload: { title: company.title, url: company.source_url, summary: company.summary, keyword_score: keywordScore, query: query.text, intent_id: query.intent_id },
              })
              continue
            }

            let domainQuality = 0.5
            let sourceDomain = company.domain || "unknown.com"
            if (sourceDomain === "unknown.com" || sourceDomain === "") {
              const resolved = await domainResolver.resolve(companyNameRaw)
              if (resolved) {
                sourceDomain = resolved
                company.domain = resolved
                domainQuality = 1.0
              }
            }
            if (sourceDomain !== "unknown.com" && sourceDomain !== "linkedin.com" && sourceDomain !== "reddit.com" &&
                sourceDomain !== "medium.com" && sourceDomain !== "dev.to" && sourceDomain !== "producthunt.com" && sourceDomain !== "github.com" &&
                sourceDomain !== "upwork.com" && sourceDomain !== "fiverr.com" && sourceDomain !== "freelancer.com" &&
                sourceDomain !== "toptal.com" && sourceDomain !== "peopleperhour.com" && sourceDomain !== "guru.com" &&
                sourceDomain !== "hashnode.com" && sourceDomain !== "stackoverflow.blog" &&
                sourceDomain !== "indiehackers.com" && sourceDomain !== "quora.com" && sourceDomain !== "stackoverflow.com" &&
                sourceDomain !== "warpforum.com" && sourceDomain !== "growthhackers.com") {
              const hasMx = await domainHasEmail(sourceDomain)
              domainQuality = hasMx ? 1.0 : 0.3
              if (!hasMx) {
                logger.info({ company: companyNameRaw, domain: sourceDomain }, "No MX record, domain quality low")
              }
            }

            const signalStrength = signal.confidence_score || 0.3
            phase2Candidates.push({ query, company, signal, keywordScore, domainQuality, signalStrength })
          }
        }

        await storeRawDiscoveries(phase2Rejected)

        // Phase 2 approved: UPDATE existing Phase 1 records to "approved" instead of INSERTing new dummy-domain records.
        let approvedCount = 0
        for (const c of phase2Candidates) {
          const realDomain = c.company.domain
          if (!realDomain || realDomain === "unknown.com") {
            // No real domain available — INSERT a new approved record with the available domain
            const { error: insError } = await supabase
              .from("discovered_companies")
              .insert({
                brand_id: brand.id,
                client_id: clientId,
                name: c.company.name || "Unknown",
                domain: c.company.source_url || `approved-${approvedCount + 1}.result`,
                website: c.company.source_url || null,
                source_name: c.query.source,
                signal_type: c.query.signal,
                enrichment_status: "approved",
                requires_enrichment: true,
                updated_at: new Date().toISOString(),
              })
            if (insError) {
              logger.warn({ error: insError.message }, "Phase 2 insert fallback failed for approved candidate")
            } else {
              approvedCount++
            }
            continue
          }
          const { error: updateError } = await supabase
            .from("discovered_companies")
            .update({
              enrichment_status: "approved",
              requires_enrichment: true,
              signal_type: c.query.signal,
              source_name: c.query.source,
              updated_at: new Date().toISOString(),
            })
            .eq("domain", realDomain)
            .eq("brand_id", brand.id)
            .eq("enrichment_status", "raw")
          if (updateError) {
            logger.warn({ domain: realDomain, error: updateError.message }, "Phase 2 update failed for approved candidate")
          } else {
            approvedCount++
          }
        }
        logger.info({ intent: intent.intent, rejected: phase2Rejected.length, passed: approvedCount }, "Phase 2 results stored for intent")

        if (phase2Candidates.length === 0) continue

        // Step 5: Phase 3 — Deep dive for this intent
        logger.info({ intent: intent.intent, count: phase2Candidates.length }, "Phase 3: Deep dive for intent")

        phase2Candidates.sort((a, b) => {
          const scoreA = (a.keywordScore.relevance_score * 0.5) + (a.signalStrength * 30) + (a.domainQuality * 20)
          const scoreB = (b.keywordScore.relevance_score * 0.5) + (b.signalStrength * 30) + (b.domainQuality * 20)
          return scoreB - scoreA
        })

        const PHASE3_EXTRACT_BATCH = 3

        // Scrape all source URLs in parallel
        const phase3Scraped: {
          candidate: typeof phase2Candidates[0];
          extractionText: string;
        }[] = await Promise.all(
          phase2Candidates.map(async (candidate) => {
            const { query, company } = candidate
            const summary = company.summary || company.name || ""
            const skipScrape = !company.source_url ||
              ["ycombinator", "producthunt", "hackernews", "hn_hiring", "hn", "jobs",
               "github", "techcrunch", "pushshift"].includes(company.source || query.source)
            if (skipScrape) return { candidate, extractionText: summary }
            try {
              const scraped = await scrapeUrl(company.source_url)
              return { candidate, extractionText: scraped || summary }
            } catch {
              return { candidate, extractionText: summary }
            }
          })
        )

        const phase3Extracted: {
          companyName: string
          domain: string | null
          description: string
          extraction: any
          keywordScore: { relevance_score: number; urgency_score: number; fit_reason: string }
          domainQuality: number
          signalStrength: number
          extractionConfidence: number
          signal: Signal
          sourceUrl: string
          brand: BrandProfile
          query: RAGQuery
        }[] = []

        const TRUSTED_SOURCES = new Set(["ycombinator", "producthunt", "hackernews", "hn_hiring", "hn", "jobs", "github", "techcrunch", "pushshift"])
        const trustedScraped = phase3Scraped.filter(s => TRUSTED_SOURCES.has(s.candidate.company.source || s.candidate.query.source))
        const otherScraped = phase3Scraped.filter(s => !TRUSTED_SOURCES.has(s.candidate.company.source || s.candidate.query.source))

        for (const s of trustedScraped) {
          if (shuttingDown) break
          const { company: companyData, query, signal, keywordScore, domainQuality, signalStrength } = s.candidate
          const companyName = companyData.name || "Unknown"
          const nameLower = companyName.toLowerCase()
          if (["top ", "best ", "list of", "alternatives", "compared",
               "worth hiring", "companies to", "should you"].some(p => nameLower.includes(p))) continue
          if (companyData.title) {
            const t = companyData.title.toLowerCase()
            if (t.includes("list of") || t.includes("top 10") || t.includes("best tools") || t.includes("alternatives to")) continue
          }
          if (isAggregatorByName(companyName)) continue
          const trustedPreVal = runPreValidation(companyName, companyData.domain, signal)
          if (!trustedPreVal.passed) {
            logger.debug({ company: companyName, reasons: trustedPreVal.rejectionReasons }, "Pre-validation rejected trusted source")
            continue
          }
          let domain = companyData.domain && companyData.domain !== "unknown.com" ? companyData.domain : null
          if (!domain) {
            const resolved = await domainResolver.resolve(companyName)
            if (resolved) domain = resolved
            else continue
          }
          const dLower = domain.toLowerCase()
          if (isAggregatorByDomain(dLower) || isJobBoardOrRecruiter(dLower, companyName) || isMediaDomain(dLower)) continue
          phase3Extracted.push({
            companyName,
            domain,
            description: companyData.summary || companyName,
            extraction: {
              type: "real_company",
              company_name: companyName,
              domain,
              description: companyData.summary || "",
              company_size: "unknown",
              industry: "unknown",
              signal_evidence: "",
              confidence: 0.7,
            },
            keywordScore,
            domainQuality,
            signalStrength,
            extractionConfidence: 0.7,
            signal,
            sourceUrl: companyData.source_url || "",
            brand,
            query,
          })
        }

        // Batch LLM extraction for non-trusted sources
        for (let i = 0; i < otherScraped.length; i += PHASE3_EXTRACT_BATCH) {
          if (shuttingDown) break
          const batch = otherScraped.slice(i, i + PHASE3_EXTRACT_BATCH)
          const batchItems = batch.map(s => ({
            title: s.candidate.company.name || "Unknown",
            text: s.extractionText,
            source: s.candidate.company.source || s.candidate.query.source,
            companyName: s.candidate.company.name,
          }))
          const extractions = await batchExtractCompanyInfo(batchItems, brand, clientId)
          for (let j = 0; j < batch.length; j++) {
            const extraction = extractions[j]
            if (!extraction) continue
            const { company: companyData, query, signal, keywordScore, domainQuality, signalStrength } = batch[j].candidate
            const companyName = extraction.company_name || companyData.name || "Unknown"
            const nameLower = companyName.toLowerCase()
            if (["top ", "best ", "list of", "alternatives", "compared",
                 "worth hiring", "companies to", "should you"].some(p => nameLower.includes(p))) continue
            if (companyData.title) {
              const t = companyData.title.toLowerCase()
              if (t.includes("list of") || t.includes("top 10") || t.includes("best tools") || t.includes("alternatives to")) continue
            }
            if (isAggregatorByName(companyName)) continue
            if (extraction.type === "news_article" && !extraction.domain) continue
            let domain = extraction.domain && extraction.domain !== "unknown.com" ? extraction.domain
              : (companyData.domain && companyData.domain !== "unknown.com" ? companyData.domain : null)
            if (!domain) {
              const resolved = await domainResolver.resolve(companyName)
              if (resolved) domain = resolved
              else continue
            }
            const dLower = domain.toLowerCase()
            if (isAggregatorByDomain(dLower) || isJobBoardOrRecruiter(dLower, companyName) || isMediaDomain(dLower)) continue
            if (extraction.company_size === "enterprise") continue
            phase3Extracted.push({
              companyName,
              domain,
              description: extraction.description || companyData.summary || companyName,
              extraction,
              keywordScore,
              domainQuality,
              signalStrength,
              extractionConfidence: extraction.confidence || 0.5,
              signal,
              sourceUrl: companyData.source_url || "",
              brand,
              query,
            })
          }
        }
        logger.info({ intent: intent.intent, passed: phase3Extracted.length }, "Phase 3 extraction completed for intent")

        // Store leads for this intent
        let phase3StoredCount = 0
        for (const r of phase3Extracted) {
          const { companyName, domain, description, extraction, keywordScore, domainQuality, signalStrength, extractionConfidence, signal, sourceUrl, query } = r
          let enrichmentPayload: any = {}
          if (domain && domain !== "unknown.com") {
            try {
              const enriched = await enrichCompany(sourceUrl || `https://${domain}`, domain, clientId)
              if (enriched) {
                enrichmentPayload = {
                  industry: enriched.industry,
                  tech_stack: enriched.tech_stack,
                  employees: enriched.employees,
                  funding: enriched.funding,
                  revenue: enriched.revenue,
                  key_people: enriched.key_people,
                  emails: enriched.emails,
                  extraction_confidence: enriched.extraction_confidence,
                  confidence_tier: enriched.confidence_tier,
                  crawl_pages: enriched.crawl_pages,
                }
              }
            } catch { /* enrichment is best-effort */ }
          }
          if (domain && domain !== "unknown.com") {
            const claimed = await isDomainClaimedByOtherBrand(domain, brand.id)
            if (claimed) {
              logger.info({ company: companyName, domain }, "Skipping — already claimed by another brand")
              continue
            }
          }
          let llmScore: LLMScore | null = null
          try {
            llmScore = await scoreCompany(
              companyName, domain, description,
              brand.brand_name, brand.product || "", brand.audience || "", brand, clientId
            )
          } catch { /* fallback to keyword-only */ }
          const { compositeScore } = computeCompositeScore({
            keywordScore, llmScore, domainQuality, signalStrength, extractionConfidence, coldStart,
          })
          const opp = normalizeOpportunity({
            title: companyName, company: companyName, source: query.source, signal,
            score: { relevance_score: compositeScore, urgency_score: keywordScore.urgency_score, fit_reason: keywordScore.fit_reason },
            url: sourceUrl, domain: domain && domain !== "unknown.com" ? domain : undefined,
            summary: description, job_title: extraction.job_title,
            linkedin_url: extraction.linkedin_url || undefined, timestamp: Date.now(),
          })
          const { stored, companyId } = await storeSignalOpportunity(opp, brand.id, query.intent_id, clientId, Object.keys(enrichmentPayload).length > 0 ? enrichmentPayload : undefined)
          if (stored) {
            phase3StoredCount++
            totalStored++
            logger.info({ company: companyName, domain, score: compositeScore }, "Lead stored from Phase 3")
            recordAdapterResult({
              adapter: query.source,
              query: query.text,
              intentId: query.intent_id || "",
              runId,
              rawCount: 1,
              approvedCount: 1,
              leadCount: 1,
            })
            leadYieldBySource[query.source] = (leadYieldBySource[query.source] || 0) + 1
            if (domain && domain !== "unknown.com") {
              addCompany({ companyName, domain, signal: query.signal || "pain", adapter: query.source })
            }
            try {
              recordLeadOutcome({
                domain: domain || "unknown.com",
                signals: [query.signal || "pain"],
                sourceAdapters: [query.source],
                domainQuality,
                signalStrength,
                extractionConfidence,
                hadContact: extraction.linkedin_url ? true : false,
                converted: false,
                timestamp: Date.now(),
              })
            } catch { /* best-effort */ }
            if (companyId && domain && domain !== "unknown.com") {
              contactQueue.push({
                brandId: brand.id, companyId, domain, name: opp.company || opp.title || "Unknown",
                summary: opp.summary || "", ragContext: query.rag_context || "",
                clientId, linkedinUrl: opp.linkedin_url,
              })
            }
          }
        }
        logger.info({ intent: intent.intent, stored: phase3StoredCount }, "Phase 3 complete for intent")

        // Phase 4: Content seed extraction — LLM reads scraped content, guided by brand profile
        const brandContextStr = [
          `brand: ${brand.brand_name || brand.product || "our brand"}`,
          brand.product ? `sells ${brand.product}` : "",
          brand.audience ? `targets ${brand.audience}` : "",
          brand.core_offer ? `offers ${brand.core_offer}` : "",
          brand.positioning ? `positioned as ${brand.positioning}` : "",
        ].filter(Boolean).join(". ")
        const seedContentItems = phase3Scraped
          .filter(s => s.extractionText && s.extractionText.length > 500)
          .slice(0, 3)
        if (seedContentItems.length > 0) {
          logger.info({ intent: intent.intent, contentPieces: seedContentItems.length }, "Phase 4: Content seed extraction")
          let seedLeadsFound = 0
          for (const item of seedContentItems) {
            const seeds = await extractContentSeeds(
              item.extractionText.slice(0, 8000),
              item.candidate.company.source_url || item.candidate.company.domain || "unknown.com",
              brandContextStr,
              clientId,
            )
            if (seeds.leads.length > 0 || seeds.queries.length > 0) {
              const leadCompanies = await discoverFromContentSeeds(
                seeds,
                [{ text: item.candidate.query.text, signal: item.candidate.query.signal, intentId: intent.id }],
                clientId,
              )
              for (const company of leadCompanies) {
                try {
                  // Phase 4 validation: run pre-validation and matching before storing
                  const seedSignal = extractSignal(company.summary || company.name || "", company.name || "");
                  const seedPreVal = runPreValidation(company.name || "Unknown", company.domain, seedSignal);
                  if (!seedPreVal.passed) {
                    logger.debug({ company: company.name, domain: company.domain, reasons: seedPreVal.rejectionReasons }, "Phase 4 seed lead rejected by pre-validation");
                    continue;
                  }
                  const seedMatch = matchOpportunity(seedSignal, brandContext);
                  if (seedMatch.relevance_score < 30) {
                    logger.debug({ company: company.name, domain: company.domain, score: seedMatch.relevance_score, reason: seedMatch.fit_reason }, "Phase 4 seed lead rejected by matching");
                    continue;
                  }
                  const opp = normalizeOpportunity({
                    title: company.name || "Unknown",
                    company: company.name || "Unknown",
                    source: "seed_extract",
                    signal: seedSignal,
                    score: { relevance_score: seedMatch.relevance_score, urgency_score: seedMatch.urgency_score, fit_reason: seedMatch.fit_reason },
                    url: company.source_url || `https://${company.domain}`,
                    domain: company.domain,
                    summary: company.summary || company.name || "",
                    timestamp: Date.now(),
                  })
                  const enrichmentPayload = company.raw ? { ...(company.raw as Record<string, unknown>), source: "seed_extract" } : undefined
                  const { stored } = await storeSignalOpportunity(opp, brand.id, intent.id, clientId, enrichmentPayload)
                  if (stored) {
                    seedLeadsFound++
                    logger.info({ company: company.name, domain: company.domain }, "Lead stored from Phase 4 seed extraction")
                    leadYieldBySource["seed_extract"] = (leadYieldBySource["seed_extract"] || 0) + 1
                  }
                } catch (err: any) {
                  logger.warn({ company: company.name, error: err.message }, "Failed to store seed lead")
                }
              }
            }
          }
          logger.info({ intent: intent.intent, seedLeads: seedLeadsFound }, "Phase 4 seed extraction completed")
        }
      }

      // Deferred contact discovery — parallel, non-blocking (across all intents)
      if (contactQueue.length > 0) {
        logger.info({ queued: contactQueue.length }, "Processing deferred contact discovery for all intents")
        const CONTACT_BATCH = 5
        for (let i = 0; i < contactQueue.length; i += CONTACT_BATCH) {
          const batch = contactQueue.slice(i, i + CONTACT_BATCH)
          await Promise.all(batch.map(async (c) => {
            const contactsStored = await discoverAndStoreContacts(c.brandId, c.companyId, c.domain, c.name, c.summary, c.ragContext, c.clientId, c.linkedinUrl)
            if (contactsStored > 0) logger.info({ company: c.name, contacts: contactsStored }, "Contacts discovered and stored")
          }))
        }
      }

      const brandDuration = Date.now() - startTime
      const sortedSources = Object.entries(leadYieldBySource)
        .sort((a, b) => b[1] - a[1])
        .map(([source, count]) => `${source}:${count}`)
        .join(",")
      logger.info({
        brand: brand.brand_name,
        intentsProcessed: intents.length,
        leadYieldBySource: sortedSources,
        brandDurationMs: brandDuration,
      }, "All intents processed for brand")
      logAgentTurn({
        run_id: runId,
        agent_id: `discovery-${brand.brand_name || brand.id}`,
        turn: 1,
        timestamp: new Date().toISOString(),
        input_tokens: 0,
        output_tokens: 0,
        tools_called: Object.keys(leadYieldBySource),
        tool_latencies_ms: phaseTimings,
        tool_errors: [],
        stop_reason: "completed",
        cost_usd: 0,
        context_utilization_pct: 0,
      })
      endTrace(traceId, log)
      incrementMetric("brands_processed")
    }

    const CONCURRENCY = 3
    for (let i = 0; i < brands.length; i += CONCURRENCY) {
      const batch = brands.slice(i, i + CONCURRENCY)
      await Promise.all(batch.map(b =>
        processBrand(b).catch(err =>
          logger.error({ brand: b.brand_name, err: err.message }, "Brand processing failed")
        )
      ))
    }

    const duration = Date.now() - startTime
    const leadYieldSummary = Object.entries(leadYieldBySource)
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => `${source}:${count}`)
      .join(", ")
    logger.info(
      { total: allOpportunities.length, stored: totalStored, durationMs: duration, leadYieldBySource: leadYieldSummary },
      "Signal-driven discovery completed"
    )

    return allOpportunities
  } catch (error: any) {
    logger.error({ error: error.message }, "Signal discovery failed")
    return allOpportunities
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

process.on("SIGINT", () => { shuttingDown = true })
process.on("SIGTERM", () => { shuttingDown = true })
