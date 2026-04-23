import pino from "pino"
import { setTimeout as sleep } from "timers/promises"

import {
  claimBrandIntents,
  getBrandProfile,
  supabase,
  type BrandIntent,
  type Opportunity,
} from "../../db/supabase"

import { executeSignalDiscovery, defaultAdapters } from "./engine"

const logger = pino({ level: "debug" })

const CLAIM_BATCH_SIZE = 3
const LOOP_INTERVAL_MS = 30_000
const DEFAULT_BRAND_DAILY_LIMIT = 50
const MAX_OPPORTUNITIES = 100

let isRunning = false

const brandExecutionCounts = new Map<string, { count: number; date: string }>()

function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0]
}

async function getBrandOpportunityLimit(brandId: string): Promise<number> {
  const brand = await getBrandProfile(brandId)
  return brand?.discovery_daily_limit ?? DEFAULT_BRAND_DAILY_LIMIT
}

async function getBrandOpportunityCount(brandId: string): Promise<number> {
  const today = getTodayDateString()
  const entry = brandExecutionCounts.get(brandId)

  if (entry && entry.date === today) {
    return entry.count
  }

  const { count } = await supabase
    .from("opportunities")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .gte("created_at", today)

  return count ?? 0
}

async function incrementBrandOpportunityCount(brandId: string): Promise<void> {
  const today = getTodayDateString()
  const current = brandExecutionCounts.get(brandId)

  let newCount = 1
  if (current && current.date === today) {
    newCount = current.count + 1
  }

  brandExecutionCounts.set(brandId, { count: newCount, date: today })
}

const activeBrandExecutions = new Set<string>()

function lockBrand(brandId: string): boolean {
  if (activeBrandExecutions.has(brandId)) {
    return false
  }
  activeBrandExecutions.add(brandId)
  return true
}

function unlockBrand(brandId: string) {
  activeBrandExecutions.delete(brandId)
}

async function processIntent(intent: BrandIntent): Promise<{ opportunities: number; errors: number }> {
  const { brand_id: brandId, id: intentId } = intent

  if (!lockBrand(brandId)) {
    logger.debug({ brandId, intentId }, "Brand already processing, skipping")
    return { opportunities: 0, errors: 0 }
  }

  try {
    const brand = await getBrandProfile(brandId)

    if (!brand || brand.is_paused || !brand.discovery_enabled) {
      logger.info({ brandId, paused: brand?.is_paused }, "Brand not eligible")
      return { opportunities: 0, errors: 0 }
    }

    const currentCount = await getBrandOpportunityCount(brandId)
    const limit = await getBrandOpportunityLimit(brandId)

    if (currentCount >= limit) {
      logger.info({ brandId, currentCount, limit }, "Brand daily limit reached")
      return { opportunities: 0, errors: 0 }
    }

    const result = await executeSignalDiscovery({
      brandId,
      intents: [intent],
      adapters: defaultAdapters,
    })

    await incrementBrandOpportunityCount(brandId)

    return result
  } catch (error) {
    logger.error(
      { brandId, intentId, error: error instanceof Error ? error.message : "Unknown" },
      "Intent processing failed"
    )
    return { opportunities: 0, errors: 1 }
  } finally {
    unlockBrand(brandId)
  }
}

async function getBrandIntentsWithOpportunities(): Promise<BrandIntent[]> {
  const { data, error } = await supabase
    .from("brand_intents")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: false })
    .limit(CLAIM_BATCH_SIZE)

  if (error) {
    logger.error({ error: error.message }, "Failed to fetch intents")
    return []
  }

  return (data ?? []) as BrandIntent[]
}

export async function startSignalScheduler() {
  if (isRunning) return
  isRunning = true

  logger.info("Signal discovery scheduler started")

  while (isRunning) {
    try {
      const intents = await getBrandIntentsWithOpportunities()

      if (!intents?.length) {
        logger.debug("No active intents found, waiting...")
        await sleep(LOOP_INTERVAL_MS)
        continue
      }

      logger.info(
        { intentCount: intents.length, intents: intents.map(i => ({ id: i.id, brand_id: i.brand_id, intent: i.intent })) },
        "Intents claimed"
      )

      for (const intent of intents) {
        const result = await processIntent(intent)
        logger.info(
          { intentId: intent.id, opportunities: result.opportunities, errors: result.errors },
          "Intent processed"
        )
      }
    } catch (error: any) {
      logger.error({ error: error?.message }, "Scheduler loop error")
      await sleep(LOOP_INTERVAL_MS)
    }
  }
}

export function stopSignalScheduler() {
  isRunning = false
}

export async function triggerEnrichmentFromOpportunities(
  brandId: string,
  minScore: number = 50
): Promise<number> {
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .eq("brand_id", brandId)
    .eq("qualification_status", "new")
    .gte("score", minScore)
    .not("domain", "is", null)
    .limit(20)

  if (error || !data?.length) {
    return 0
  }

  const domains = data.map(o => o.domain).filter(Boolean) as string[]

  const { error: updateError } = await supabase
    .from("opportunities")
    .update({ qualification_status: "qualified" })
    .in("domain", domains)
    .eq("brand_id", brandId)

  if (updateError) {
    logger.warn({ error: updateError.message }, "Failed to mark qualified")
    return 0
  }

  logger.info(
    { brandId, count: data.length, domains },
    "Marked opportunities for enrichment"
  )

  return data.length
}