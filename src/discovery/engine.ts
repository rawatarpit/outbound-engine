import pino from "pino"
import {
  supabase,
  DiscoverySource,
  releaseDiscoverySource
} from "../db/supabase"

import { getExecutor, type Executor, type ExecutorParams, type BatchExecutor } from "./registry"
import { withTimeout, TimeoutError } from "./utils/timeout"
import { DiscoveryError } from "./errors"
import {
  deduplicateCompanies,
  deduplicateContacts,
  type DeduplicatedCompany,
  type DeduplicatedContact
} from "./deduplicator"

import type { DiscoveryResult, DiscoveryCompany, DiscoveryContact } from "./types"

const logger = pino({ level: "debug" })

/* =========================================================
   CONFIG
========================================================= */

const EXECUTOR_TIMEOUT_MS = 120_000
const MAX_RETRIES = 5
const MAX_GLOBAL_ITEMS = 500
const BATCH_SIZE = 10

/* =========================================================
   BRAND VALIDATION
========================================================= */

async function validateBrandForDiscovery(brandId: string) {
  const { data: brand, error } = await supabase
    .from("brand_profiles")
    .select("id, discovery_enabled")
    .eq("id", brandId)
    .single()

  if (error || !brand) {
    throw new Error("Brand not found")
  }

  if (!brand.discovery_enabled) {
    throw new Error("Discovery disabled for brand")
  }

  return brand
}

/* =========================================================
   CIRCUIT BREAKER
========================================================= */

async function triggerCircuitBreaker(sourceId: string) {
  const { error } = await supabase
    .from("brand_discovery_sources")
    .update({
      is_active: false,
      last_error: "circuit_breaker_triggered"
    })
    .eq("id", sourceId)

  if (error) {
    logger.error({ sourceId, error: error.message }, "Failed to disable discovery source via circuit breaker")
  } else {
    logger.error({ sourceId }, "Discovery source disabled via circuit breaker")
  }
}

/* =========================================================
   DB OPERATIONS
========================================================= */

async function insertCompaniesBatch(
  sourceId: string,
  brandId: string,
  companies: DiscoveryCompany[]
): Promise<number> {
  const companyRows = deduplicateCompanies(companies, sourceId, brandId)

  if (companyRows.length === 0) return 0

  const { error } = await supabase
    .from("discovered_companies")
    .upsert(companyRows, { onConflict: "brand_id,domain" })

  if (error) {
    logger.error({ sourceId, error: error.message, count: companyRows.length }, "Failed to insert companies batch")
    throw new DiscoveryError(`Failed to insert companies: ${error.message}`, "fatal")
  }

  logger.info({ sourceId, count: companyRows.length }, "Inserted companies batch")
  return companyRows.length
}

async function insertContactsBatch(
  sourceId: string,
  brandId: string,
  contacts: DiscoveryContact[]
): Promise<number> {
  const { data: companyMapRows } = await supabase
    .from("discovered_companies")
    .select("id, domain")
    .eq("brand_id", brandId)

  const companyMap = new Map<string, string>()
  for (const row of companyMapRows ?? []) {
    companyMap.set(row.domain, row.id)
  }

  const contactRows = deduplicateContacts(contacts, sourceId, brandId, companyMap)

  if (contactRows.length === 0) return 0

  const { error } = await supabase
    .from("discovered_contacts")
    .upsert(contactRows, { onConflict: "brand_id,email" })

  if (error) {
    logger.error({ sourceId, error: error.message, count: contactRows.length }, "Failed to insert contacts batch")
    throw new DiscoveryError(`Failed to insert contacts: ${error.message}`, "fatal")
  }

  logger.info({ sourceId, count: contactRows.length }, "Inserted contacts batch")
  return contactRows.length
}

async function onBatchInsert(
  sourceId: string,
  brandId: string,
  batch: DiscoveryResult
): Promise<{ companies: number; contacts: number }> {
  const companiesInserted = await insertCompaniesBatch(sourceId, brandId, batch.companies ?? [])
  const contactsInserted = await insertContactsBatch(sourceId, brandId, batch.contacts ?? [])
  return { companies: companiesInserted, contacts: contactsInserted }
}

/* =========================================================
   STREAMING EXECUTE (BATCH INCREMENTAL INSERT)
========================================================= */

async function executeStreaming(
  source: DiscoverySource,
  validatedConfig: unknown,
  registered: { execute: BatchExecutor<unknown> }
): Promise<{ totalCompanies: number; totalContacts: number }> {
  let totalCompanies = 0
  let totalContacts = 0
  let batchNumber = 0

  const onBatch = async (batch: DiscoveryResult): Promise<void> => {
    batchNumber++
    const { companies, contacts } = await onBatchInsert(source.id, source.brand_id, batch)
    totalCompanies += companies
    totalContacts += contacts
    console.log(`[STREAM] Batch ${batchNumber}: ${companies} companies, ${contacts} contacts inserted`)
  }

  await registered.execute(
    { sourceId: source.id, brandId: source.brand_id, config: validatedConfig },
    onBatch,
    BATCH_SIZE
  )

  return { totalCompanies, totalContacts }
}

/* =========================================================
   STANDARD EXECUTE (FALLBACK FOR LEGACY EXECUTORS)
========================================================= */

async function executeStandard(
  source: DiscoverySource,
  validatedConfig: unknown,
  registered: { execute: Executor<unknown> }
): Promise<{ totalCompanies: number; totalContacts: number }> {
  const results: DiscoveryResult = await withTimeout(
    registered.execute({
      sourceId: source.id,
      brandId: source.brand_id,
      config: validatedConfig
    }),
    EXECUTOR_TIMEOUT_MS
  )

  if (!results) {
    throw new DiscoveryError("Executor returned empty result", "retryable")
  }

  const safeCompanies = (results.companies ?? []).slice(0, MAX_GLOBAL_ITEMS)
  const safeContacts = (results.contacts ?? []).slice(0, MAX_GLOBAL_ITEMS)

  const companiesInserted = await insertCompaniesBatch(source.id, source.brand_id, safeCompanies)
  const contactsInserted = await insertContactsBatch(source.id, source.brand_id, safeContacts)

  return { totalCompanies: companiesInserted, totalContacts: contactsInserted }
}

/* =========================================================
   MAIN EXECUTION
========================================================= */

export async function executeSource(source: DiscoverySource): Promise<void> {
  const start = Date.now()

  logger.info({ sourceId: source.id, type: source.type, brandId: source.brand_id }, "Discovery execution started")

  let classification: "retryable" | "fatal" = "retryable"
  let totalCompanies = 0
  let totalContacts = 0

  try {
    await validateBrandForDiscovery(source.brand_id)

    const registered = getExecutor(source.type)

    if (!registered) {
      throw new DiscoveryError(`No executor registered for type: ${source.type}`, "fatal")
    }

    let validatedConfig
    try {
      validatedConfig = registered.schema.parse(source.config)
    } catch (parseError: any) {
      logger.error({ sourceId: source.id, type: source.type, rawConfig: source.config, parseError: parseError?.message }, "Config validation failed")
      throw new DiscoveryError(`Config validation failed: ${parseError?.message}`, "fatal")
    }

    const executor = registered.execute as any
    const isStreaming = (registered.execute as any).length >= 3

    if (isStreaming) {
      console.log(`[STREAM] Using streaming executor for ${source.type}`)
      const result = await executeStreaming(source, validatedConfig, { execute: executor })
      totalCompanies = result.totalCompanies
      totalContacts = result.totalContacts
    } else {
      console.log(`[STREAM] Using standard executor for ${source.type}`)
      const result = await executeStandard(source, validatedConfig, { execute: executor })
      totalCompanies = result.totalCompanies
      totalContacts = result.totalContacts
    }

    const { error: counterError } = await supabase.rpc("increment_discovery_counter", { p_brand_id: source.brand_id })
    if (counterError) {
      logger.error({ brandId: source.brand_id, error: counterError.message }, "Failed incrementing discovery counter")
    }

    await releaseDiscoverySource({
      source_id: source.id,
      success: true,
      companies: totalCompanies,
      contacts: totalContacts,
      duration_ms: Date.now() - start
    })

    logger.info({
      sourceId: source.id,
      durationMs: Date.now() - start,
      companiesInserted: totalCompanies,
      contactsInserted: totalContacts,
    }, "Discovery execution completed")

  } catch (error: any) {
    if (error instanceof TimeoutError) {
      classification = "retryable"
    } else if (error instanceof DiscoveryError) {
      classification = error.type
    } else {
      classification = "retryable"
    }

    logger.error({ sourceId: source.id, error: error?.message, classification }, "Discovery execution failed")

    if (classification === "fatal" || (source.retry_count ?? 0) + 1 >= MAX_RETRIES) {
      await triggerCircuitBreaker(source.id)
    }

    await releaseDiscoverySource({
      source_id: source.id,
      success: false,
      error: error?.message ?? "Unknown error",
      duration_ms: Date.now() - start
    })

    throw error
  }
}