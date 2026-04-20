import pino from "pino"
import { runApifyActor } from "./client"

const logger = pino({ level: "info" })

/* ----------------------------------------
   Types
----------------------------------------- */

export interface ApifyConfig {
  actorId: string
  input: unknown
  mapping: Record<string, string>
  filters?: {
    requireEmail?: boolean
    requireDomain?: boolean
  }
  limit?: number
}

export interface NormalizedDiscoveryLead {
  email?: string | null
  name?: string | null
  company?: string | null
  domain?: string | null
  raw_payload: any
}

/* ----------------------------------------
   Utility: Dot-path resolver
----------------------------------------- */

function getByPath(obj: any, path?: string): any {
  if (!obj || !path) return undefined
  return path.split(".").reduce((acc, key) => acc?.[key], obj)
}

/* ----------------------------------------
   Core Executor
----------------------------------------- */

export async function executeApifyDiscovery(
  config: ApifyConfig,
  token: string
): Promise<NormalizedDiscoveryLead[]> {

  if (!config.actorId) {
    throw new Error("Apify config missing actorId")
  }

  if (!config.mapping) {
    throw new Error("Apify config missing mapping")
  }

  const limit = config.limit ?? 100

  logger.info(
    { actorId: config.actorId },
    "Running Apify actor"
  )

  const rawItems = await runApifyActor(
    config.actorId,
    config.input,
    token
  )

  if (!Array.isArray(rawItems)) {
    throw new Error("Apify returned non-array dataset")
  }

  const trimmedItems = rawItems.slice(0, limit)

  const normalized: NormalizedDiscoveryLead[] = []

  for (const item of trimmedItems) {

    const lead: NormalizedDiscoveryLead = {
      email: getByPath(item, config.mapping.email) ?? null,
      name: getByPath(item, config.mapping.name) ?? null,
      company: getByPath(item, config.mapping.company) ?? null,
      domain: getByPath(item, config.mapping.domain) ?? null,
      raw_payload: item
    }

    // Apply filters
    if (config.filters?.requireEmail && !lead.email) {
      continue
    }

    if (config.filters?.requireDomain && !lead.domain) {
      continue
    }

    // Skip empty rows
    if (!lead.email && !lead.domain) {
      continue
    }

    normalized.push(lead)
  }

  logger.info(
    {
      actorId: config.actorId,
      fetched: rawItems.length,
      accepted: normalized.length
    },
    "Apify discovery completed"
  )

  return normalized
}