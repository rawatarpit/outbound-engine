import pino from "pino"
import type { Executor } from "../../registry"
import type { DiscoveryResult } from "../../types"
import {
  DiscoveryError
} from "../../errors"

import {
  indieHackersSchema,
  IndieHackersConfig,
  IH_MAX_GLOBAL_ITEMS
} from "./schema"

import { transformIndieProfile } from "./transform"

const logger = pino({ level: "info" })

export const indieHackersExecutor:
  Executor<IndieHackersConfig> =
  async ({ sourceId, brandId, config }) => {

    const startTime = Date.now()

    try {

      /*
       NOTE:
       IndieHackers does not provide a stable public API.
       In production you would:
       - Use Apify actor
       - Or controlled scraping endpoint
       - Or internal scraper service
      */

      // Placeholder for future integration
      const rawProfiles: any[] = []

      const companies = []
      const contacts = []

      for (const profile of rawProfiles) {

        if (
          companies.length >= IH_MAX_GLOBAL_ITEMS
        ) break

        const transformed =
          transformIndieProfile(
            profile,
            sourceId
          )

        if (transformed.company) {
          companies.push(transformed.company)
        }

        if (transformed.contact) {
          contacts.push(transformed.contact)
        }
      }

      const duration = Date.now() - startTime

      logger.info(
        {
          sourceId,
          brandId,
          companies: companies.length,
          contacts: contacts.length,
          duration_ms: duration
        },
        "IndieHackers discovery completed"
      )

      const result: DiscoveryResult = {
        companies,
        contacts,
        meta: {
          executor: "indiehackers",
          risk: "MODERATE_PUBLIC" as any,
          total_fetched: rawProfiles.length,
          total_companies: companies.length,
          total_contacts: contacts.length,
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
        err?.message ?? "IndieHackers executor failed",
        "retryable"
      )
    }
  }