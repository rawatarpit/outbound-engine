import pino from "pino"

import {
  claimContactsForEnrichment,
  claimCompaniesForEnrichment
} from "./claim"

import { buildEnrichmentPlan } from "./strategyRouter"
import { getStrategyExecutor } from "./strategies/registry"
import { validateEnrichedData } from "./utils/validators"
import { computeConfidence } from "./scoring"
import { persistEnrichmentResult } from "./update"
import { enforceSafety } from "./safety"

import {
  EnrichmentStatus,
  FinalEnrichmentOutcome,
  EnrichmentStrategyType
} from "./types"

import { getRunnableBrands } from "../db/supabase"

const logger = pino({ level: "info" })

/* =========================================================
   CONFIG
========================================================= */

const CONFIG = {
  batchSize: 10,
  targetConfidence: 0.75,
  maxAttempts: 3
}

type EnrichmentTargetType = "company" | "contact"

/* =========================================================
   MAIN WORKER
========================================================= */

export async function runEnrichmentWorker(): Promise<void> {
  logger.info("Enrichment worker started")

  const brands = await getRunnableBrands()
  if (!brands.length) {
    logger.debug("No active brands found")
    return
  }

  for (const brand of brands) {
    try {
      if (brand.is_paused) continue
      await processBrandEnrichment(brand.id)
    } catch (err: any) {
      logger.error(
        { brandId: brand.id, error: err?.message },
        "Brand-level enrichment failure"
      )
    }
  }

  logger.info("Enrichment worker completed batch")
}

/* =========================================================
   BRAND LEVEL ENRICHMENT
========================================================= */

async function processBrandEnrichment(brandId: string) {
  const companies = await claimCompaniesForEnrichment(
    brandId,
    CONFIG.batchSize
  )

  if (companies.length) {
    logger.info(
      { brandId, count: companies.length },
      "Claimed companies for enrichment"
    )
  }

  for (const company of companies) {
    await processEntity("company", company)
  }

  const contacts = await claimContactsForEnrichment(
    brandId,
    CONFIG.batchSize
  )

  if (contacts.length) {
    logger.info(
      { brandId, count: contacts.length },
      "Claimed contacts for enrichment"
    )
  }

  for (const contact of contacts) {
    await processEntity("contact", contact)
  }
}

/* =========================================================
   GENERIC ENTITY PROCESSOR
========================================================= */

async function processEntity(
  type: EnrichmentTargetType,
  entity: any
): Promise<void> {
  try {
    const safe = await enforceSafety({
      type,
      entity,
      targetConfidence: CONFIG.targetConfidence,
      maxAttempts: CONFIG.maxAttempts
    })

    if (!safe.allowed) {
      await persistEnrichmentResult({
        type,
        entityId: entity.id,
        status: EnrichmentStatus.SKIPPED,
        finalConfidence: entity.confidence ?? 0,
        strategiesAttempted: []
      })
      return
    }

    const plan = await buildEnrichmentPlan({
      type,
      entity,
      targetConfidence: CONFIG.targetConfidence,
      maxAttempts: CONFIG.maxAttempts
    })

    if (!plan.shouldProceed) {
      await persistEnrichmentResult({
        type,
        entityId: entity.id,
        status: EnrichmentStatus.SKIPPED,
        finalConfidence: entity.confidence ?? 0,
        strategiesAttempted: []
      })
      return
    }

    let finalConfidence = entity.confidence ?? 0
    let enrichedData: any = null
    const attempted: EnrichmentStrategyType[] = []

    for (const strategyType of plan.strategies) {
      const executor = getStrategyExecutor(strategyType)
      if (!executor) continue

      attempted.push(strategyType)

      const result = await executor.execute({
        type,
        entity,
        targetConfidence: CONFIG.targetConfidence,
        maxAttempts: CONFIG.maxAttempts
      })

      if (result.status === EnrichmentStatus.FAILED) continue
      if (!result.data) continue

      const validated = validateEnrichedData(result.data)
      if (!validated.valid) continue

      const newConfidence = computeConfidence(
        type,
        entity,
        result.data
      )

      const prevConfidence = finalConfidence
      finalConfidence = Math.max(finalConfidence, newConfidence)

      if (!enrichedData || newConfidence > prevConfidence) {
        enrichedData = result.data
      }

      if (finalConfidence >= CONFIG.targetConfidence) break
    }

    // Normalize floating precision
    finalConfidence = Number(finalConfidence.toFixed(3))

    let status: EnrichmentStatus

    if (!enrichedData) {
      status = EnrichmentStatus.FAILED
    } else if (finalConfidence >= CONFIG.targetConfidence) {
      status = EnrichmentStatus.SUCCESS
    } else {
      status = EnrichmentStatus.PARTIAL
    }

    const outcome: FinalEnrichmentOutcome = {
      type,
      entityId: entity.id,
      status,
      finalConfidence,
      enrichedData,
      strategiesAttempted: attempted,
    }

    await persistEnrichmentResult(outcome)

    logger.info(
      {
        type,
        entityId: entity.id,
        status,
        finalConfidence,
        strategiesAttempted: attempted
      },
      "Enrichment completed"
    )

  } catch (error: any) {
    logger.error(
      {
        type,
        entityId: entity.id,
        error: error?.message
      },
      "Entity enrichment failure"
    )
  }
}