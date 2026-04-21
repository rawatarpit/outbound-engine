import pino from "pino"
import { setTimeout as sleep } from "timers/promises"

import {
  claimDiscoveredCompanies,
  completeDiscoveredCompany,
  claimDiscoveredContacts,
  completeDiscoveredContact,
  ingestLead,
  isBlacklisted
} from "../db/supabase"

import { normalizeDomain, normalizeEmail } from "./normalizer"
import { DiscoveryRisk } from "./types"

const logger = pino({ level: "debug" })

const CLAIM_BATCH_SIZE = 20
const LOOP_INTERVAL_MS = 8000
const MIN_CONFIDENCE = 0.75

let running = false

/* =========================================================
   HELPERS
========================================================= */

function capConfidenceByRisk(
  risk: DiscoveryRisk | null,
  confidence?: number | null
): number {
  const base = confidence ?? 0.5

  switch (risk) {
    case DiscoveryRisk.SAFE_API:
      return base
    case DiscoveryRisk.MODERATE_PUBLIC:
      return Math.min(base, 0.8)
    case DiscoveryRisk.HIGH_SCRAPE:
      return Math.min(base, 0.6)
    default:
      return base
  }
}

function shouldAutoIngest(contact: {
  email: string | null
  risk: DiscoveryRisk | null
  confidence: number | null
  requires_enrichment: boolean
}): boolean {
  const capped = capConfidenceByRisk(contact.risk, contact.confidence)

  if (!contact.email) return false
  if (contact.requires_enrichment) return false
  if (capped < MIN_CONFIDENCE) return false
  if (contact.risk === DiscoveryRisk.HIGH_SCRAPE) return false

  return true
}

/* =========================================================
   COMPANY PROCESSING
========================================================= */

async function processCompanies() {
  const items = await claimDiscoveredCompanies(CLAIM_BATCH_SIZE)
  if (!items.length) return

  for (const company of items) {
    try {
      const normalized = normalizeDomain(company.domain)

      if (!normalized) {
        await completeDiscoveredCompany({
          id: company.id,
          success: false,
          error: "Invalid domain"
        })
        continue
      }

      const blacklisted = await isBlacklisted(undefined, normalized)
      if (blacklisted) {
        await completeDiscoveredCompany({
          id: company.id,
          success: false,
          error: "Domain blacklisted"
        })
        continue
      }

      // Optional: enforce minimum confidence floor
      const confidence = company.confidence ?? 0.5
      if (confidence < 0.35) {
        await completeDiscoveredCompany({
          id: company.id,
          success: false,
          error: "Low confidence"
        })
        continue
      }

      await completeDiscoveredCompany({
        id: company.id,
        success: true
      })

    } catch (error: any) {
      logger.error(
        { id: company.id, error: error?.message },
        "Company processing failed"
      )

      await completeDiscoveredCompany({
        id: company.id,
        success: false,
        error: error?.message ?? "Unknown error"
      })
    }
  }
}

/* =========================================================
   CONTACT PROCESSING
========================================================= */

async function processContacts() {
  const items = await claimDiscoveredContacts(CLAIM_BATCH_SIZE)
  if (!items.length) return

  for (const contact of items) {
    try {
      const normalizedEmail = contact.email
        ? normalizeEmail(contact.email)
        : undefined

      const domain =
        normalizedEmail?.split("@")[1] ??
        (contact.domain ? normalizeDomain(contact.domain) : null)

      if (!domain) {
        await completeDiscoveredContact({
          id: contact.id,
          success: false,
          error: "Invalid domain"
        })
        continue
      }

      if (normalizedEmail) {
        const blacklisted = await isBlacklisted(normalizedEmail, domain)
        if (blacklisted) {
          await completeDiscoveredContact({
            id: contact.id,
            success: false,
            error: "Email/domain blacklisted"
          })
          continue
        }
      }

      if (contact.risk === DiscoveryRisk.HIGH_SCRAPE) {
        await completeDiscoveredContact({
          id: contact.id,
          success: true,
          requires_enrichment: true
        })
        continue
      }

      if (!shouldAutoIngest(contact)) {
        await completeDiscoveredContact({
          id: contact.id,
          success: true,
          requires_enrichment: true
        })
        continue
      }

      if (!normalizedEmail) {
        await completeDiscoveredContact({
          id: contact.id,
          success: true,
          requires_enrichment: true
        })
        continue
      }

      await ingestLead({
        brand_id: contact.brand_id,
        first_name: contact.first_name ?? undefined,
        last_name: contact.last_name ?? undefined,
        full_name: contact.full_name ?? undefined,
        email: normalizedEmail,
        title: contact.title ?? undefined,
        domain,
        source: "discovery",
        source_id: contact.source_id ?? undefined,
        raw_payload: contact.raw_payload
      })

      await completeDiscoveredContact({
        id: contact.id,
        success: true
      })

    } catch (error: any) {
      logger.error(
        { id: contact.id, error: error?.message },
        "Contact processing failed"
      )

      await completeDiscoveredContact({
        id: contact.id,
        success: false,
        error: error?.message ?? "Unknown error"
      })
    }
  }
}

/* =========================================================
   LOOP
========================================================= */

export async function startDiscoveryProcessor() {
  if (running) return
  running = true

  logger.info("Discovery processor started")

  while (running) {
    try {
      await processCompanies()
      await processContacts()
    } catch (error: any) {
      logger.error({ error: error?.message }, "Processor loop error")
    }

    await sleep(LOOP_INTERVAL_MS)
  }
}

export function stopDiscoveryProcessor() {
  running = false
}