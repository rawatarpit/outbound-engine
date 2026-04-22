import pino from "pino"
import type { Executor } from "../../registry"
import type { DiscoveryResult } from "../../types"
import {
  DiscoveryError,
  classifyHttpStatus
} from "../../errors"

import {
  hunterSchema,
  HunterConfig,
  HUNTER_MAX_GLOBAL_ITEMS
} from "./schema"

import { transformHunterResponse } from "./transform"

const logger = pino({ level: "info" })

export const hunterExecutor: Executor<HunterConfig> =
  async ({ sourceId, brandId, config }) => {

    const startTime = Date.now()

    try {
      const queryParams = new URLSearchParams({
        api_key: config.api_key,
        limit: String(config.limit)
      })

      if (config.domain) {
        queryParams.set("domain", config.domain)
      }

      if (config.company) {
        queryParams.set("company", config.company)
      }

      const url =
        `https://api.hunter.io/v2/domain-search?${queryParams.toString()}`

      const res = await fetch(url)

      if (!res.ok) {
        const text = await res.text()
        const failureType = classifyHttpStatus(res.status)

        throw new DiscoveryError(
          `Hunter API error: ${res.status} - ${text}`,
          failureType,
          {
            metadata: { status: res.status }
          }
        )
      }

      const json = await res.json()

      const { companies, contacts } =
        transformHunterResponse(
          json,
          sourceId,
          brandId
        )

      const safeCompanies =
        companies.slice(0, HUNTER_MAX_GLOBAL_ITEMS)

      const safeContacts =
        contacts.slice(0, HUNTER_MAX_GLOBAL_ITEMS)

      const duration = Date.now() - startTime

      logger.info(
        {
          sourceId,
          brandId,
          companies: safeCompanies.length,
          contacts: safeContacts.length,
          duration_ms: duration
        },
        "Hunter discovery completed"
      )

      const result: DiscoveryResult = {
        companies: safeCompanies,
        contacts: safeContacts,
        meta: {
          executor: "hunter",
          risk: "SAFE_API" as any,
          total_fetched: safeContacts.length,
          total_companies: safeCompanies.length,
          total_contacts: safeContacts.length,
          source_health: "healthy",
          duration_ms: duration
        }
      }

      return result

    } catch (err: any) {

      if (err instanceof DiscoveryError) {
        throw err
      }

      throw new DiscoveryError(
        err?.message ?? "Hunter executor failed",
        "retryable"
      )
    }
  }