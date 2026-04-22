import pino from "pino"
import type { Executor } from "../../registry"
import type { DiscoveryResult } from "../../types"
import {
  DiscoveryError,
  classifyHttpStatus
} from "../../errors"

import {
  apolloSchema,
  ApolloConfig,
  APOLLO_MAX_GLOBAL_ITEMS
} from "./schema"

import { transformApolloResponse } from "./transform"

const logger = pino({ level: "info" })

export const apolloExecutor: Executor<ApolloConfig> =
  async ({ sourceId, brandId, config }) => {

    const startTime = Date.now()

    const companies = []
    const contacts = []

    try {
      for (let page = 1; page <= config.max_pages; page++) {

        if (
          companies.length >= APOLLO_MAX_GLOBAL_ITEMS
        ) break

        const body = {
          api_key: config.api_key,
          page,
          per_page: config.limit,
          q_keywords: config.query ?? ""
        }

        const res = await fetch(
          "https://api.apollo.io/v1/mixed_people/search",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
          }
        )

        if (!res.ok) {
          const text = await res.text()
          const failureType =
            classifyHttpStatus(res.status)

          throw new DiscoveryError(
            `Apollo API error: ${res.status} - ${text}`,
            failureType,
            {
              metadata: { status: res.status }
            }
          )
        }

        const json = await res.json()

        const transformed =
          transformApolloResponse(
            json,
            sourceId
          )

        companies.push(...transformed.companies)
        contacts.push(...transformed.contacts)

        if (!json.people?.length) break
      }

      const safeCompanies =
        companies.slice(0, APOLLO_MAX_GLOBAL_ITEMS)

      const safeContacts =
        contacts.slice(0, APOLLO_MAX_GLOBAL_ITEMS)

      const duration = Date.now() - startTime

      logger.info(
        {
          sourceId,
          brandId,
          companies: safeCompanies.length,
          contacts: safeContacts.length,
          duration_ms: duration
        },
        "Apollo discovery completed"
      )

      const result: DiscoveryResult = {
        companies: safeCompanies,
        contacts: safeContacts,
        meta: {
          executor: "apollo",
          risk: "low" as any,
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
        err?.message ?? "Apollo executor failed",
        "retryable"
      )
    }
  }