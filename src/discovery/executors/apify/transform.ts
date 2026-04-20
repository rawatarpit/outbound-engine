// src/discovery/executors/apify/transform.ts

import pino from "pino"
import { ApifyConfig } from "./schema"

const logger = pino({ level: "info" })

/* -----------------------------------------
   Types
------------------------------------------ */

export interface TransformedApifyLead {
  email: string | null
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  company?: string | null
  domain?: string | null
  title?: string | null
  raw_payload: any
}

/* -----------------------------------------
   Utilities
------------------------------------------ */

function getByPath(obj: any, path?: string): any {
  if (!obj || !path) return undefined

  try {
    return path.split(".").reduce((acc, key) => acc?.[key], obj)
  } catch {
    return undefined
  }
}

function cleanString(value: any): string | null {
  if (!value) return null
  if (typeof value !== "string") return null

  const trimmed = value.trim()
  if (!trimmed) return null

  return trimmed
}

function extractDomainFromEmail(email?: string | null): string | null {
  if (!email) return null
  if (!email.includes("@")) return null

  return email.split("@")[1]?.toLowerCase() ?? null
}

function isValidEmail(email?: string | null): boolean {
  if (!email) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/* -----------------------------------------
   Core Transform Function
------------------------------------------ */

export function transformApifyResults(
  rawItems: any[],
  config: ApifyConfig
): TransformedApifyLead[] {

  const results: TransformedApifyLead[] = []
  const limit = config.limit ?? 100

  const items = rawItems.slice(0, limit)

  for (const item of items) {

    try {
      const emailRaw = cleanString(getByPath(item, config.mapping.email))
      const nameRaw = cleanString(getByPath(item, config.mapping.name))
      const firstNameRaw = cleanString(getByPath(item, config.mapping.first_name))
      const lastNameRaw = cleanString(getByPath(item, config.mapping.last_name))
      const companyRaw = cleanString(getByPath(item, config.mapping.company))
      const domainRaw = cleanString(getByPath(item, config.mapping.domain))
      const titleRaw = cleanString(getByPath(item, config.mapping.title))

      const email = emailRaw?.toLowerCase() ?? null

      if (config.filters?.requireEmail && !email) continue
      if (config.filters?.requireDomain && !domainRaw && !email) continue

      if (email && !isValidEmail(email)) continue

      const domain =
        domainRaw?.toLowerCase() ??
        extractDomainFromEmail(email)

      if (!email && !domain) continue

      results.push({
        email,
        first_name: firstNameRaw ?? null,
        last_name: lastNameRaw ?? null,
        full_name: nameRaw ?? null,
        company: companyRaw ?? null,
        domain: domain ?? null,
        title: titleRaw ?? null,
        raw_payload: item
      })

    } catch (err) {
      logger.warn(
        { error: (err as any)?.message },
        "Apify transform error for item"
      )
      continue
    }
  }

  return results
}