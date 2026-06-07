import pino from "pino"
import { getLLMApiKey, getLLMBaseUrl, getLLMModel } from "../../discovery/utils/api-keys"
import type { DiscoveryCompany } from "../../discovery/types"
import { DiscoveryRisk } from "../../discovery/types"
import { getToolByName } from "../../harness/toolRegistry"
import { getAdapterToolsBySource } from "../../harness/adapterTools"

const logger = pino({ level: "info" })

export interface DiscoveryWorkerCompany {
  name: string
  domain: string
  source_url: string
  summary: string
  industry?: string | null
  tech_stack?: string[]
  employees?: string | null
  funding?: string | null
  revenue?: string | null
  key_people?: { name: string; title: string }[]
  emails?: string[]
  extraction_confidence: number
  confidence_tier: string
  source: string
  signal_type?: string
  intent_id?: string
  crawl_pages?: number
  content_length?: number
  raw_content?: string
}

interface SearchQueryInput {
  text: string
  signal: string
  intentId: string
  source?: string
}

interface SearchCandidate {
  url: string
  domain: string
  signal_type: string
  intent_id: string
}

interface LLMConfig {
  llm_api_key?: string
  llm_base_url: string
  llm_model: string
}

interface ForgeResult {
  industry?: string
  tech_stack?: string
  summary?: string
  employees?: string
  revenue?: string
  emails?: string
}

interface ScrapeResult {
  name?: string
  domain: string
  source_url: string
  summary?: string
  industry?: string | null
  tech_stack?: string[]
  employees?: string | null
  funding?: string | null
  key_people?: { name: string; title: string }[]
  emails?: string[]
  extraction_confidence: number
  confidence_tier: string
  crawl_pages: number
  content_length: number
  raw_content?: string
}

function normalizeToDiscoveryCompany(
  raw: DiscoveryWorkerCompany,
): DiscoveryCompany | null {
  if (!raw.domain) return null

  const signal = raw.signal_type || ""
  const intentId = raw.intent_id || ""

  return {
    source: "open_source_worker",
    source_url: raw.source_url || `https://${raw.domain}`,
    risk: raw.extraction_confidence >= 0.8
      ? DiscoveryRisk.SAFE_API
      : raw.extraction_confidence >= 0.5
        ? DiscoveryRisk.MODERATE_PUBLIC
        : DiscoveryRisk.HIGH_SCRAPE,
    domain: raw.domain,
    name: raw.name || raw.domain,
    summary: (raw.summary || raw.name || raw.domain).substring(0, 500),
    signal_type: signal,
    raw: {
      intent_id: intentId,
      signal,
      industry: raw.industry || null,
      tech_stack: raw.tech_stack || [],
      employees: raw.employees || null,
      funding: raw.funding || null,
      revenue: raw.revenue || null,
      key_people: raw.key_people || [],
      emails: raw.emails || [],
      extraction_confidence: raw.extraction_confidence,
      confidence_tier: raw.confidence_tier,
      crawl_pages: raw.crawl_pages || 0,
      content_length: raw.content_length || 0,
    },
  } as unknown as DiscoveryCompany
}

function ensureV1(baseUrl: string): string {
  const url = baseUrl.replace(/\/+$/, "")
  return url.endsWith("/v1") ? url : `${url}/v1`
}

async function getLLMConfig(clientId?: string): Promise<LLMConfig> {
  const apiKey = await getLLMApiKey(clientId)
  const baseUrl = await getLLMBaseUrl(clientId)
  const model = await getLLMModel(clientId)
  return {
    llm_api_key: apiKey || undefined,
    llm_base_url: baseUrl ? ensureV1(baseUrl) : "https://integrate.api.nvidia.com/v1",
    llm_model: model || "meta/llama-3.1-8b-instruct",
  }
}

async function callSearch(
  queries: SearchQueryInput[],
  maxResults: number,
): Promise<SearchCandidate[]> {
  const hnQueries = queries.filter(q => q.source === "hn_hiring" || q.source === "hackernews")
  const ycQueries = queries.filter(q => q.source === "yc")
  const newsQueries = queries.filter(q => q.source === "news")
  const redditQueries = queries.filter(q => q.source === "reddit")
  const pushshiftQueries = queries.filter(q => q.source === "pushshift")
  const indeedQueries = queries.filter(q => q.source === "indeed")
  const jobsQueries = queries.filter(q => q.source === "jobs")
  const restQueries = queries.filter(q => {
    const s = q.source
    return s !== "hn_hiring" && s !== "hackernews" && s !== "yc" && s !== "news"
      && s !== "reddit" && s !== "pushshift" && s !== "indeed" && s !== "jobs"
  })

  const toHarness = (qs: SearchQueryInput[]) =>
    qs.map(q => ({ text: q.text, signal: q.signal, intent_id: q.intentId }))

  const results: SearchCandidate[] = []

  const runAdapterBatch = async (qs: SearchQueryInput[], adapterName: string): Promise<SearchCandidate[]> => {
    if (qs.length === 0) return []
    const tool = getAdapterToolsBySource(adapterName)
    if (!tool) {
      logger.warn({ adapter: adapterName }, `No harness tool for adapter, falling back to search_web`)
      const raw = await getToolByName("search_web")!.executor({ queries: toHarness(qs), max_results: maxResults })
      return (raw as SearchCandidate[]) || []
    }
    const all: SearchCandidate[] = []
    for (const q of qs) {
      try {
        const result = await tool.executor({
          query: q.text,
          intent_id: q.intentId,
          signal: q.signal,
          clientId: undefined,
        })
        for (const r of (result as any[]) || []) {
          all.push({
            url: r.source_url || r.url || "",
            domain: r.domain || "",
            signal_type: r.signal_type || q.signal,
            intent_id: q.intentId,
          })
        }
      } catch (err: any) {
        logger.warn({ adapter: adapterName, query: q.text, error: err.message }, `Adapter search failed`)
      }
    }
    return all
  }

  const [hn, yc, news, reddit, pushshift, indeed, jobs, rest] = await Promise.all([
    hnQueries.length
      ? (await getToolByName("search_hackernews")!.executor({ queries: toHarness(hnQueries), max_results: maxResults }))
      : Promise.resolve([]),
    ycQueries.length
      ? (await getToolByName("search_y_combinator")!.executor({ queries: toHarness(ycQueries), max_results: maxResults }))
      : Promise.resolve([]),
    newsQueries.length
      ? (await getToolByName("search_web")!.executor({ queries: toHarness(newsQueries), max_results: maxResults, mode: "news" }))
      : Promise.resolve([]),
    runAdapterBatch(redditQueries, "reddit"),
    runAdapterBatch(pushshiftQueries, "pushshift"),
    runAdapterBatch(indeedQueries, "indeed"),
    runAdapterBatch(jobsQueries, "jobs"),
    restQueries.length
      ? (await getToolByName("search_web")!.executor({ queries: toHarness(restQueries), max_results: maxResults }))
      : Promise.resolve([]),
  ])

  results.push(...hn, ...yc, ...news, ...reddit, ...pushshift, ...indeed, ...jobs, ...rest)

  if (results.length === 0 && queries.length > 0) {
    logger.warn({ queryCount: queries.length }, "All search sources returned empty results")
  }

  return results
}

async function callForge(domain: string): Promise<ForgeResult> {
  try {
    const result = await getToolByName("enrich_company_forge")!.executor({ domain })
    return result || {}
  } catch (err: any) {
    logger.warn({ error: err.message, domain }, "FORGE subprocess failed")
    return {}
  }
}

async function callScrapeExtract(
  url: string,
  domain: string,
  llm: LLMConfig,
): Promise<ScrapeResult | null> {
  try {
    const result = await getToolByName("scrape_extract_company")!.executor({
      url, domain,
      llm_api_key: llm.llm_api_key,
      llm_base_url: llm.llm_base_url,
      llm_model: llm.llm_model,
    })
    return result
  } catch (err: any) {
    logger.warn({ error: err.message, domain }, "Scrape/extract subprocess failed")
    return null
  }
}

function mergeCompanyData(
  candidate: SearchCandidate,
  forge: ForgeResult,
  scrape: ScrapeResult | null,
): DiscoveryWorkerCompany | null {
  if (!scrape) return null

  const techStackSet = new Set(scrape.tech_stack || [])
  if (forge.tech_stack) {
    const forgeItems = forge.tech_stack.split(";").map(t => t.trim()).filter(Boolean)
    for (const t of forgeItems) {
      techStackSet.add(t)
    }
  }

  const fallbackName = candidate.domain.split(".")[0]
  const name = fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1)

  return {
    name: scrape.name || name,
    domain: candidate.domain,
    source_url: scrape.source_url || candidate.url,
    summary: (scrape.summary || forge.summary || scrape.name || name).substring(0, 500),
    industry: scrape.industry || forge.industry || null,
    tech_stack: Array.from(techStackSet),
    employees: scrape.employees || forge.employees || null,
    funding: scrape.funding || null,
    revenue: forge.revenue || null,
    key_people: scrape.key_people || [],
    emails: (scrape.emails?.length ? scrape.emails : (forge.emails ? forge.emails.split(";") : [])),
    extraction_confidence: scrape.extraction_confidence || 0,
    confidence_tier: scrape.confidence_tier || "low",
    source: "open_source_worker",
    signal_type: candidate.signal_type || "",
    intent_id: candidate.intent_id || "",
    crawl_pages: scrape.crawl_pages || 0,
    content_length: scrape.content_length || 0,
    raw_content: scrape.raw_content || "",
  }
}

export async function discoverCompaniesBatch(
  queries: SearchQueryInput[],
  maxResults: number = 3,
  clientId?: string,
): Promise<DiscoveryCompany[]> {
  const llm = await getLLMConfig(clientId)

  const candidates = await callSearch(queries, maxResults)
  if (!candidates.length) {
    logger.info({ queries: queries.length }, "No candidates found from search")
    return []
  }

  logger.info({ candidates: candidates.length }, "Processing candidates with FORGE + scrape in parallel")

  const companies: DiscoveryWorkerCompany[] = []
  for (const cand of candidates) {
    const [forge, scrape] = await Promise.all([
      callForge(cand.domain),
      callScrapeExtract(cand.url, cand.domain, llm),
    ])
    const merged = mergeCompanyData(cand, forge, scrape)
    if (merged) {
      companies.push(merged)
    }
  }

  const result = companies
    .map(c => normalizeToDiscoveryCompany(c))
    .filter((c): c is DiscoveryCompany => c !== null)

  logger.info({ queries: queries.length, candidates: candidates.length, found: result.length }, "Discovery batch completed")
  return result
}

export async function discoverCompanies(
  query: string,
  signal: string,
  intentId: string,
  maxResults: number = 5,
  clientId?: string,
  source?: string,
): Promise<DiscoveryCompany[]> {
  return discoverCompaniesBatch([{ text: query, signal, intentId, source }], maxResults, clientId)
}

export async function enrichCompany(
  url: string,
  domain: string,
  clientId?: string,
): Promise<DiscoveryWorkerCompany | null> {
  const llm = await getLLMConfig(clientId)

  try {
    const [forge, scrape] = await Promise.all([
      callForge(domain),
      callScrapeExtract(url, domain, llm),
    ])

    if (!scrape) return null

    const techStackSet = new Set(scrape.tech_stack || [])
    if (forge.tech_stack) {
      const forgeItems = forge.tech_stack.split(";").map(t => t.trim()).filter(Boolean)
      for (const t of forgeItems) {
        techStackSet.add(t)
      }
    }

    const fallbackName = domain.split(".")[0]
    const name = fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1)

    return {
      name: scrape.name || name,
      domain,
      source_url: scrape.source_url || url,
      summary: (scrape.summary || forge.summary || scrape.name || name).substring(0, 500),
      industry: scrape.industry || forge.industry || null,
      tech_stack: Array.from(techStackSet),
      employees: scrape.employees || forge.employees || null,
      funding: scrape.funding || null,
      revenue: forge.revenue || null,
      key_people: scrape.key_people || [],
      emails: (scrape.emails?.length ? scrape.emails : (forge.emails ? forge.emails.split(";") : [])),
      extraction_confidence: scrape.extraction_confidence || 0,
      confidence_tier: scrape.confidence_tier || "low",
      source: "open_source_worker",
      crawl_pages: scrape.crawl_pages || 0,
      content_length: scrape.content_length || 0,
      raw_content: scrape.raw_content || "",
    }
  } catch (err: any) {
    logger.error({ error: err.message, domain }, "Enrich failed")
    return null
  }
}

function computeConfidenceTier(confidence: number): string {
  if (confidence >= 0.8) return "high"
  if (confidence >= 0.5) return "medium"
  return "low"
}

export async function verifyExtraction(
  extracted: Record<string, unknown>,
  scrapedText: string,
): Promise<{ confidence: number; tier: string; verified: Record<string, unknown> } | null> {
  try {
    const textLower = scrapedText.toLowerCase()
    const verified: Record<string, unknown> = {}
    let fieldsFound = 0
    let totalFields = 0

    if (extracted.name) {
      totalFields++
      if (textLower.includes(String(extracted.name).toLowerCase())) {
        verified.name = extracted.name
        fieldsFound++
      }
    }

    if (extracted.industry) {
      totalFields++
      if (textLower.includes(String(extracted.industry).toLowerCase())) {
        verified.industry = extracted.industry
        fieldsFound++
      }
    }

    if (extracted.description) {
      totalFields++
      const descWords = new Set(String(extracted.description).toLowerCase().split(/\s+/))
      if (descWords.size > 0) {
        let matchCount = 0
        for (const word of descWords) {
          if (textLower.includes(word)) matchCount++
        }
        if (matchCount / descWords.size >= 0.7) {
          verified.description = extracted.description
          fieldsFound++
        }
      }
    }

    if (extracted.tech_stack && Array.isArray(extracted.tech_stack)) {
      const approved: string[] = []
      for (const item of extracted.tech_stack) {
        if (item && textLower.includes(String(item).toLowerCase())) {
          approved.push(String(item))
        }
      }
      if (approved.length > 0) verified.tech_stack = approved
    }

    if (extracted.employees) {
      totalFields++
      if (textLower.includes(String(extracted.employees).toLowerCase())) {
        verified.employees = extracted.employees
        fieldsFound++
      }
    }

    if (extracted.funding) {
      totalFields++
      if (textLower.includes(String(extracted.funding).toLowerCase())) {
        verified.funding = extracted.funding
        fieldsFound++
      }
    }

    if (extracted.key_people && Array.isArray(extracted.key_people)) {
      const approved: { name: string; title: string }[] = []
      for (const person of extracted.key_people) {
        const p = person as { name?: string; title?: string }
        const pname = (p.name || "").trim()
        const ptitle = (p.title || "").trim()
        if (pname && (textLower.includes(pname.toLowerCase()) || textLower.includes(pname.split(" ").pop()?.toLowerCase() || ""))) {
          approved.push({ name: pname, title: ptitle })
        }
      }
      if (approved.length > 0) verified.key_people = approved
    }

    let confidence = 0
    if (totalFields > 0) {
      confidence = Math.round((fieldsFound / totalFields) * 100) / 100
    } else if (verified.name || verified.industry) {
      confidence = 0.5
    } else if (Object.keys(extracted).length > 0) {
      confidence = 0.3
    }

    return {
      confidence,
      tier: computeConfidenceTier(confidence),
      verified,
    }
  } catch {
    return null
  }
}

export interface ContentSeedLead {
  name: string
  domain_hint?: string | null
  reason?: string
}

export interface ContentSeedQuery {
  text: string
  signal: string
}

export interface ContentSeeds {
  context_summary: string
  author: { name?: string; role?: string; company?: string }
  pain_points: string[]
  signals: { type: string; description: string }[]
  queries: ContentSeedQuery[]
  leads: ContentSeedLead[]
  _duration_ms?: number
}

async function callSeedExtract(
  content: string,
  sourceDomain: string,
  brandContext: string,
  llm: LLMConfig,
): Promise<ContentSeeds> {
  try {
    const result = await getToolByName("extract_content_seeds")!.executor({
      content,
      source_domain: sourceDomain,
      brand_context: brandContext,
      llm_api_key: llm.llm_api_key,
      llm_base_url: llm.llm_base_url,
      llm_model: llm.llm_model,
    })
    return result as ContentSeeds
  } catch (err: any) {
    logger.warn({ error: err.message, domain: sourceDomain }, "Seed extract subprocess failed")
    return { context_summary: "", author: {}, pain_points: [], signals: [], queries: [], leads: [] }
  }
}

export async function extractContentSeeds(
  content: string,
  sourceDomain: string,
  brandContext: string = "",
  clientId?: string,
): Promise<ContentSeeds> {
  const llm = await getLLMConfig(clientId)
  return callSeedExtract(content, sourceDomain, brandContext, llm)
}

export async function discoverFromContentSeeds(
  seeds: ContentSeeds,
  originalQueries: { text: string; signal: string; intentId: string }[],
  clientId?: string,
): Promise<DiscoveryCompany[]> {
  const llm = await getLLMConfig(clientId)
  const allCompanies: DiscoveryWorkerCompany[] = []

  logger.info({
    context: seeds.context_summary?.slice(0, 120),
    author: seeds.author?.name || "unknown",
    painPoints: seeds.pain_points?.length || 0,
    signals: seeds.signals?.length || 0,
    queries: seeds.queries?.length || 0,
  }, "Processing content seeds")

  // 1. Process direct leads — only if they have a real domain and reason
  for (const lead of seeds.leads || []) {
    const domain = lead.domain_hint
    if (!domain || !domain.includes(".")) continue
    try {
      const [forge, scrape] = await Promise.all([
        callForge(domain),
        callScrapeExtract(`https://${domain}`, domain, llm),
      ])
      const merged = mergeCompanyData(
        { url: `https://${domain}`, domain, signal_type: "seed_lead", intent_id: originalQueries[0]?.intentId || "" },
        forge,
        scrape,
      )
      if (merged) allCompanies.push(merged)
    } catch {
      // skip
    }
  }

  // 2. Run new search queries generated from the content
  if ((seeds.queries || []).length > 0) {
    const newsKeywords = ["raise", "funding", "announced", "launch", "series", "acquire", "acquired"]
    const now = new Date()

    for (const q of seeds.queries) {
      const hasNewsSignal = newsKeywords.some(kw => q.text.toLowerCase().includes(kw))

      // Primary: search via DDG web
      let moreCompanies = await discoverCompaniesBatch(
        [{ text: q.text, signal: q.signal, intentId: originalQueries[0]?.intentId || "seed", source: "search" }],
        3,
        clientId,
      )
      for (const c of moreCompanies) {
        const raw = c as unknown as DiscoveryWorkerCompany
        raw.signal_type = "seed_query"
        allCompanies.push(raw)
      }

      // Secondary: also try news mode for this query
      if (moreCompanies.length === 0 || hasNewsSignal) {
        const moreNews = await discoverCompaniesBatch(
          [{ text: q.text, signal: q.signal, intentId: originalQueries[0]?.intentId || "seed", source: "news" }],
          3,
          clientId,
        )
        for (const c of moreNews) {
          const raw = c as unknown as DiscoveryWorkerCompany
          raw.signal_type = "seed_query_news"
          allCompanies.push(raw)
        }
      }
    }
  }

  const result = allCompanies
    .map(c => normalizeToDiscoveryCompany(c))
    .filter((c): c is DiscoveryCompany => c !== null)

  logger.info({ queries: (seeds.queries || []).length, leads: (seeds.leads || []).length, found: result.length }, "Content seed discovery completed")
  return result
}

function isLikelyCompanyDomain(domain: string): boolean {
  const skipDomains = new Set([
    "wikipedia.org", "github.com", "medium.com", "reddit.com",
    "linkedin.com", "youtube.com", "twitter.com", "facebook.com",
    "stackoverflow.com", "producthunt.com",
  ])
  const lower = domain.toLowerCase()
  if (skipDomains.has(lower)) return false
  for (const suffix of [".gov", ".edu", ".ac.uk", ".gov.uk"]) {
    if (lower.endsWith(suffix)) return false
  }
  return domain.includes(".")
}
