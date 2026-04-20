import pino from "pino"
import {
  supabase,
  DiscoverySource,
  releaseDiscoverySource
} from "../db/supabase"

import { getExecutor } from "./registry"
import { normalizeDomain, normalizeEmail } from "./normalizer"
import { withTimeout, TimeoutError } from "./utils/timeout"
import { DiscoveryError } from "./errors"

import type { DiscoveryResult } from "./types"

const logger = pino({ level: "info" })

/* =========================================================
   CONFIG
========================================================= */

const EXECUTOR_TIMEOUT_MS = 120_000
const MAX_RETRIES = 5
const MAX_GLOBAL_ITEMS = 500

/* =========================================================
   BRAND VALIDATION
========================================================= */

async function validateBrandForDiscovery(
  brandId: string
) {
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
   DISCOVERY COUNTER
========================================================= */

async function incrementDiscoveryCounter(
  brandId: string
) {
  const { error } = await supabase.rpc(
    "increment_discovery_counter",
    { p_brand_id: brandId }
  )

  if (error) {
    logger.error(
      { brandId, error: error.message },
      "Failed incrementing discovery counter"
    )
  }
}

/* =========================================================
   CIRCUIT BREAKER
========================================================= */

async function triggerCircuitBreaker(
  sourceId: string
) {
  await supabase
    .from("brand_discovery_sources")
    .update({
      is_active: false,
      last_error: "circuit_breaker_triggered"
    })
    .eq("id", sourceId)

  logger.error(
    { sourceId },
    "Discovery source disabled via circuit breaker"
  )
}

/* =========================================================
   MAIN EXECUTION
========================================================= */

export async function executeSource(
  source: DiscoverySource
): Promise<void> {
  const start = Date.now()

  logger.info(
    {
      sourceId: source.id,
      type: source.type,
      brandId: source.brand_id
    },
    "Discovery execution started"
  )

  let classification: "retryable" | "fatal" = "retryable"

  try {
    /* ------------------------------------------
       1. BRAND GUARD
    ------------------------------------------ */

    await validateBrandForDiscovery(source.brand_id)

    /* ------------------------------------------
       2. GET EXECUTOR
    ------------------------------------------ */

    const registered = getExecutor(source.type)

    if (!registered) {
      throw new DiscoveryError(
        `No executor registered for type: ${source.type}`,
        "fatal"
      )
    }

    /* ------------------------------------------
       3. VALIDATE CONFIG
    ------------------------------------------ */

    const validatedConfig =
      registered.schema.parse(source.config)

    /* ------------------------------------------
       4. EXECUTE WITH TIMEOUT
    ------------------------------------------ */

    const results: DiscoveryResult =
      await withTimeout(
        registered.execute({
          sourceId: source.id,
          brandId: source.brand_id,
          config: validatedConfig
        }),
        EXECUTOR_TIMEOUT_MS
      )

    if (!results) {
      throw new DiscoveryError(
        "Executor returned empty result",
        "retryable"
      )
    }

    /* ------------------------------------------
       5. HARD GLOBAL CAP
    ------------------------------------------ */

    const safeCompanies = (results.companies ?? [])
      .slice(0, MAX_GLOBAL_ITEMS)

    const safeContacts = (results.contacts ?? [])
      .slice(0, MAX_GLOBAL_ITEMS)

    /* ------------------------------------------
       6. PREPARE COMPANIES
    ------------------------------------------ */

    const companyRows = safeCompanies
      .map((company) => {
        if (!company.domain) return null

        const normalizedDomain =
          normalizeDomain(company.domain)

        if (!normalizedDomain) return null

        return {
          brand_id: source.brand_id,
          source_id: source.id,
          name: company.name ?? null,
          domain: normalizedDomain,
          raw_payload: company.raw ?? company,
          processed: false,
          ingested: false,
          risk: company.risk ?? null,
          confidence: company.confidence ?? null,
          intent_score: company.intent_score ?? null,
          requires_enrichment:
            company.requires_enrichment ?? false
        }
      })
      .filter(Boolean)

    if (companyRows.length > 0) {
      await supabase
        .from("discovered_companies")
        .upsert(companyRows, {
          onConflict: "brand_id,domain"
        })
    }

    /* ------------------------------------------
       7. BUILD COMPANY MAP
    ------------------------------------------ */

    const { data: companyMapRows } =
      await supabase
        .from("discovered_companies")
        .select("id, domain")
        .eq("brand_id", source.brand_id)

    const companyMap = new Map<string, string>()

    for (const row of companyMapRows ?? []) {
      companyMap.set(row.domain, row.id)
    }

    /* ------------------------------------------
       8. PREPARE CONTACTS
    ------------------------------------------ */

    const contactRows = safeContacts
      .map((contact) => {
        const normalizedDomain =
          normalizeDomain(contact.domain)

        if (!normalizedDomain) return null

        const companyId =
          companyMap.get(normalizedDomain)

        if (!companyId) return null

        const normalizedEmail =
          contact.email
            ? normalizeEmail(contact.email)
            : null

        return {
          brand_id: source.brand_id,
          source_id: source.id,
          discovered_company_id: companyId,
          first_name: contact.first_name ?? null,
          last_name: contact.last_name ?? null,
          full_name: contact.full_name ?? null,
          email: normalizedEmail,
          title: contact.title ?? null,
          linkedin_url:
            contact.linkedin_url ?? null,
          raw_payload: contact.raw ?? contact,
          processed: false,
          ingested: false,
          risk: contact.risk ?? null,
          confidence: contact.confidence ?? null,
          intent_score: contact.intent_score ?? null,
          requires_enrichment:
            contact.requires_enrichment ?? true
        }
      })
      .filter(Boolean)

    if (contactRows.length > 0) {
      await supabase
        .from("discovered_contacts")
        .upsert(contactRows, {
          onConflict: "brand_id,email"
        })
    }

    /* ------------------------------------------
       9. COUNTER
    ------------------------------------------ */

    await incrementDiscoveryCounter(
      source.brand_id
    )

    /* ------------------------------------------
       10. RELEASE SUCCESS
    ------------------------------------------ */

    await releaseDiscoverySource({
      source_id: source.id,
      success: true,
      companies: companyRows.length,
      contacts: contactRows.length,
      duration_ms: Date.now() - start
    })

    logger.info(
      {
        sourceId: source.id,
        durationMs: Date.now() - start,
        companiesInserted: companyRows.length,
        contactsInserted: contactRows.length,
        meta: results.meta ?? null
      },
      "Discovery execution completed"
    )
  } catch (error: any) {
    /* ------------------------------------------
       ERROR CLASSIFICATION
    ------------------------------------------ */

    if (error instanceof TimeoutError) {
      classification = "retryable"
    } else if (error instanceof DiscoveryError) {
      classification = error.type
    } else {
      classification = "retryable"
    }

    logger.error(
      {
        sourceId: source.id,
        error: error?.message,
        classification
      },
      "Discovery execution failed"
    )

    /* ------------------------------------------
       CIRCUIT BREAKER
    ------------------------------------------ */

    if (
      classification === "fatal" ||
      (source.retry_count ?? 0) + 1 >= MAX_RETRIES
    ) {
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