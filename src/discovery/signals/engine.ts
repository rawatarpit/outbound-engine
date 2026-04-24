import pino from "pino"
import { supabase, BrandProfile } from "../../db/supabase"
import { SIGNAL_WEIGHTS, type SignalType, type Opportunity, type BrandIntent } from "./types"
import { DiscoveryAdapter, getAdaptersForSignal, createAdapterRegistry } from "./adapter"
import { generateQueries } from "./queryGenerator"

import { SearchAdapter } from "./adapters/search"

const logger = pino({ level: "debug" })

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_OPPORTUNITIES_PER_SIGNAL = 50

interface BrandCredentials {
  discoveryApiKey?: string
}

async function getBrandCredentials(brandId: string): Promise<BrandCredentials> {
  const { data: brand } = await supabase
    .from("brand_profiles")
    .select("discovery_api_key")
    .eq("id", brandId)
    .single()

  if (!brand) {
    return {}
  }

  return {
    discoveryApiKey: brand.discovery_api_key || undefined,
  }
}

function createAdaptersForBrand(
  brandId: string,
  credentials: BrandCredentials,
): Map<string, DiscoveryAdapter> {
  const adapters: DiscoveryAdapter[] = []

  // Always add SearchAdapter - uses Scrapling by default
  adapters.push(
    new SearchAdapter(
      { zenserpApiKey: credentials.discoveryApiKey },
      brandId,
    ),
  )

  return createAdapterRegistry(adapters)
}

const defaultAdapters = createAdapterRegistry([
  new SearchAdapter({}),
])

export interface SignalDiscoveryConfig {
  brandId: string
  intents: BrandIntent[]
  adapters?: Map<string, DiscoveryAdapter>
  timeout?: number
  credentials?: BrandCredentials
}

async function validateBrandIntent(
  brandId: string
): Promise<BrandProfile> {
  const { data: brand, error } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("id", brandId)
    .single()

  if (error || !brand) {
    throw new Error("Brand not found or inactive")
  }

  if (!brand.discovery_enabled) {
    throw new Error("Discovery disabled for brand")
  }

  return brand
}

async function getActiveIntents(
  brandId: string
): Promise<BrandIntent[]> {
  const { data, error } = await supabase
    .from("brand_intents")
    .select("*")
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .order("priority", { ascending: false })
    .limit(10)

  if (error) {
    logger.error({ brandId, error: error.message }, "Failed to fetch intents")
    return []
  }

  return (data ?? []) as BrandIntent[]
}

function calculateScore(
  opportunity: Opportunity,
  signalWeight: number,
): number {
  const signalScore = signalWeight * opportunity.confidence
  const recencyBonus = Math.min(10, Date.now() / 1000000000 % 10)

  return Math.min(100, signalScore + recencyBonus)
}

async function fetchAndNormalize(
  adapter: DiscoveryAdapter,
  query: string,
  signal: SignalType,
): Promise<Opportunity[]> {
  try {
    const result = await adapter.fetch({ query, signal })
    const normalized = adapter.normalize(result.raw)

    return normalized.slice(0, MAX_OPPORTUNITIES_PER_SIGNAL)
  } catch (error) {
    logger.error(
      { adapter: adapter.source, query, error: error instanceof Error ? error.message : "Unknown" },
      "Adapter fetch failed"
    )
    return []
  }
}

async function storeOpportunities(
  brandId: string,
  intentId: string | undefined,
  opportunities: Opportunity[]
): Promise<number> {
  if (opportunities.length === 0) return 0

  const rows = opportunities.map((opp) => ({
    brand_id: brandId,
    intent_id: intentId,
    entity_type: opp.entity_type,
    name: opp.name,
    domain: opp.domain ?? null,
    signal: opp.signal,
    sub_signal: opp.sub_signal ?? null,
    source: opp.source,
    confidence: Math.round((opp.confidence || 0.5) * 100),
    score: Math.round(opp.score || 0),
    metadata: opp.metadata ?? {},
  }))

  const { error } = await supabase
    .from("opportunities")
    .upsert(rows, {
      onConflict: "brand_id,domain,source,signal",
    })

  if (error) {
    logger.error({ error: error.message, count: rows.length }, "Failed to store opportunities")
    return 0
  }

  return opportunities.length
}

async function triggerEnrichment(
  brandId: string,
  opportunities: Opportunity[]
): Promise<void> {
  const highScoreOpp = opportunities
    .filter(o => o.score >= 50)
    .slice(0, 20)

  if (highScoreOpp.length === 0) return

  const { error } = await supabase
    .from("opportunities")
    .update({ qualification_status: "qualified" })
    .in("domain", highScoreOpp.map(o => o.domain!).filter(Boolean))
    .eq("brand_id", brandId)

  if (error) {
    logger.warn({ error: error.message }, "Failed to mark qualified")
  }

  logger.info(
    { brandId, count: highScoreOpp.length },
    "Marked opportunities for enrichment"
  )
}

export async function executeSignalDiscovery(
  config: SignalDiscoveryConfig
): Promise<{ opportunities: number; errors: number }> {
  const start = Date.now()

  let totalOpportunities = 0
  let totalErrors = 0

  try {
    const brand = await validateBrandIntent(config.brandId)

    let adapters: Map<string, DiscoveryAdapter>
    if (config.adapters) {
      adapters = config.adapters
    } else {
      const credentials = config.credentials ?? await getBrandCredentials(config.brandId)
      adapters = createAdaptersForBrand(config.brandId, credentials)
    }

    const intents = config.intents.length > 0
      ? config.intents
      : await getActiveIntents(config.brandId)

    if (intents.length === 0) {
      logger.info({ brandId: config.brandId }, "No active intents found")
      return { opportunities: 0, errors: 0 }
    }

    logger.info(
      { brandId: config.brandId, intentCount: intents.length },
      "Processing intents"
    )

    for (const intent of intents) {
      const signals = intent.signals as SignalType[]
      if (!signals || signals.length === 0) continue

      const queries = generateQueries(signals[0], {
        product: brand.product,
        positioning: brand.positioning,
        coreOffer: brand.core_offer,
        audience: brand.audience,
        painPoints: brand.objection_guidelines,
      })

      for (const signal of signals) {
        const signalAdapters = getAdaptersForSignal(adapters, signal)

        if (signalAdapters.length === 0) {
          logger.debug({ signal }, "No adapters support this signal")
          continue
        }

        for (const adapter of signalAdapters) {
          for (const query of queries.slice(0, 5)) {
            const rawOpps = await fetchAndNormalize(adapter, query, signal)

            const scoredOpps = rawOpps.map(opp => ({
              ...opp,
              score: calculateScore(opp, SIGNAL_WEIGHTS[opp.signal] ?? 10),
            }))

            const stored = await storeOpportunities(
              config.brandId,
              intent.id,
              scoredOpps
            )

            if (stored > 0) {
              await triggerEnrichment(config.brandId, scoredOpps)
            }

            totalOpportunities += stored
          }
        }
      }
    }

    logger.info(
      { brandId: config.brandId, duration: Date.now() - start, totalOpportunities },
      "Signal discovery completed"
    )

    return { opportunities: totalOpportunities, errors: totalErrors }
  } catch (error) {
    logger.error(
      { brandId: config.brandId, error: error instanceof Error ? error.message : "Unknown" },
      "Signal discovery failed"
    )
    throw error
  }
}

export { defaultAdapters, createAdaptersForBrand, getBrandCredentials }
export type { DiscoveryAdapter } from "./adapter"
export { SignalType, SIGNAL_WEIGHTS }
export type { Opportunity, BrandIntent } from "./types"