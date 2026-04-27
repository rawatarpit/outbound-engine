import { SignalType } from "./types"
import type { BrandProfile } from "../../db/supabase"

const PAIN_SIGNALS = [
  "outbound not working",
  "cold email not getting replies",
  "lead generation is hard",
  "struggling with sales",
  "prospecting takes too long",
  "email outreach not converting",
  "pipeline empty",
  "need b2b leads",
  "manual prospecting is exhausting",
  "not getting responses",
  "outbound is dead",
  "cold calling doesn't work",
  "sales pipeline dry",
  "need more leads",
  "how to get customers",
]

const HIRING_SIGNALS = [
  "first sales hire",
  "building sales team",
  "need help with outbound",
  "looking for sales rep",
  "hiring b2b sales",
  "need experienced closer",
  "hiring account executive",
  "hiring sales closer",
  "need sales representative",
  "seeking sales help",
  "building outbound team",
]

const INTENT_SIGNALS = [
  "how to get first b2b customers",
  "manual prospecting takes too long",
  "looking for alternatives",
  "best tool for outbound",
  "sales automation tool",
  "cold email software",
  "lead generation software",
]

function extractKeywords(text: string | null | undefined): string[] {
  if (!text) return []
  
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'under', 'again', 'further', 'then', 'once', 'here',
    'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few',
    'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
    'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 'just',
    'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them',
    'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
    'i', 'me', 'my', 'myself', 'us', 'ours', 'him', 'his', 'her',
    'its', 'they', 'them', 'their', 'mine', 'yours', 'hers', 'ours',
  ])
  
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
  
  return [...new Set(words)].slice(0, 10)
}

function generateVariations(
  base: string,
  product: string,
  audience: string | null
): string[] {
  const variations: string[] = [base]
  
  if (product && base.toLowerCase().includes(product.toLowerCase()) === false) {
    variations.push(`${product} ${base}`)
    variations.push(`${base} ${product}`)
  }
  
  if (audience) {
    variations.push(`${audience} ${base}`)
  }
  
  variations.push(`${base} for startup`)
  variations.push(`${base} for b2b`)
  
  return [...new Set(variations)].slice(0, 5)
}

function generatePainQueries(
  product: string,
  positioning: string | null,
  coreOffer: string | null,
  audience: string | null
): string[] {
  const queries: string[] = []
  
  const keywords = [
    ...extractKeywords(product),
    ...extractKeywords(positioning),
    ...extractKeywords(coreOffer),
    ...extractKeywords(audience),
  ]
  
  for (const signal of PAIN_SIGNALS.slice(0, 5)) {
    queries.push(signal)
    
    for (const keyword of keywords.slice(0, 3)) {
      queries.push(`${signal} ${keyword}`)
      queries.push(`${keyword} ${signal}`)
    }
  }
  
  return [...new Set(queries)].slice(0, 10)
}

function generateHiringQueries(
  product: string,
  positioning: string | null,
  coreOffer: string | null,
  audience: string | null
): string[] {
  const queries: string[] = []
  
  const keywords = [
    ...extractKeywords(product),
    ...extractKeywords(positioning),
    ...extractKeywords(coreOffer),
  ]
  
  for (const signal of HIRING_SIGNALS.slice(0, 5)) {
    queries.push(signal)
    
    if (keywords.length > 0) {
      for (const keyword of keywords.slice(0, 2)) {
        queries.push(`${signal} ${keyword}`)
      }
    }
  }
  
  return [...new Set(queries)].slice(0, 8)
}

function generateIntentQueries(
  product: string,
  positioning: string | null,
  coreOffer: string | null,
  audience: string | null
): string[] {
  const queries: string[] = []
  
  const keywords = [
    ...extractKeywords(product),
    ...extractKeywords(coreOffer),
  ]
  
  for (const signal of INTENT_SIGNALS.slice(0, 5)) {
    queries.push(signal)
    
    for (const keyword of keywords.slice(0, 2)) {
      queries.push(`${signal} ${keyword}`)
    }
  }
  
  return [...new Set(queries)].slice(0, 8)
}

function generateGenericQueries(signal: string): string[] {
  switch (signal) {
    case "funding":
    case "funding_announcement":
      return ["raised seed round", "series funding", "announced funding", "Series A startup"]
    case "launch":
    case "product_launch":
      return ["launched new product", "public beta", "announcing launch", "new startup launch"]
    case "growth_activity":
      return ["scaling revenue", "growing b2b", "building sales engine", "hired sales team"]
    case "tech_usage":
      return ["best CRM for startup", "sales tool recommendations", "outbound platform", "sales software"]
    case "advertising":
      return ["google ads help", "marketing agency", "paid acquisition", "b2b advertising"]
    case "partnership":
      return ["seeking partners", "looking for partnerships", "strategic partnerships"]
    case "expansion":
      return ["expanding team", "scaling sales", "growing b2b", "market expansion"]
    case "automation_need":
      return ["outbound automation", "sales outreach tool", "cold email software", "lead generation software"]
    default:
      return [signal]
  }
}

export interface QueryGeneratorConfig {
  product: string
  positioning?: string | null
  coreOffer?: string | null
  audience?: string | null
  painPoints?: string | null
}

export function generateQueries(
  signal: string,
  brand: QueryGeneratorConfig,
  useSiteFilters: boolean = false,
): string[] {
  const { product, positioning, coreOffer, audience } = brand
  
  if (!product) {
    return generateGenericQueries(signal).slice(0, 5)
  }

  let queries: string[] = []

  switch (signal) {
    case "pain":
    case "outbound_pain":
      queries = generatePainQueries(product, positioning, coreOffer, audience)
      break
    
    case "hiring":
    case "hiring_sales":
    case "hiring_engineer":
    case "remote_hiring":
    case "hiring_agency":
      queries = generateHiringQueries(product, positioning, coreOffer, audience)
      break
    
    case "intent":
    case "founder_intent":
      queries = generateIntentQueries(product, positioning, coreOffer, audience)
      break
    
    default:
      queries = generateGenericQueries(signal)
  }

  const final = queries
    .filter(q => q.length > 3 && q.length < 80)
    .slice(0, 10)

  return final
}

export function generateSignalQueriesForBrand(
  brand: BrandProfile,
  signals: string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>()

  const config: QueryGeneratorConfig = {
    product: brand.product,
    positioning: brand.positioning,
    coreOffer: brand.core_offer,
    audience: brand.audience,
    painPoints: brand.objection_guidelines,
  }

  for (const signal of signals) {
    const queries = generateQueries(signal, config)
    result.set(signal, queries)
  }

  return result
}
