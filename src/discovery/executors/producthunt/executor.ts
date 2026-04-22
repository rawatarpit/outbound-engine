import pino from "pino"
import type { Executor } from "../../registry"
import type { DiscoveryResult } from "../../types"
import {
  DiscoveryError,
  classifyHttpStatus
} from "../../errors"

import {
  productHuntSchema,
  ProductHuntConfig,
  PH_MAX_GLOBAL_ITEMS
} from "./schema"

import { transformProductHuntNode } from "./transform"

const logger = pino({ level: "info" })

type TokenCacheEntry = {
  token: string
  expiresAt: number
}

const tokenCache = new Map<string, TokenCacheEntry>()

async function getAccessToken(
  sourceId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {

  const existing = tokenCache.get(sourceId)

  if (existing && existing.expiresAt > Date.now()) {
    return existing.token
  }

  const response = await fetch(
    "https://api.producthunt.com/v2/oauth/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials"
      })
    }
  )

  if (!response.ok) {
    throw new DiscoveryError(
      `ProductHunt token request failed: ${response.status}`,
      classifyHttpStatus(response.status)
    )
  }

  const json = await response.json()

  const token = json.access_token
  const expiresIn = json.expires_in ?? 3600

  tokenCache.set(sourceId, {
    token,
    expiresAt: Date.now() + (expiresIn - 60) * 1000
  })

  return token
}

export const productHuntExecutor:
  Executor<ProductHuntConfig> =
  async ({ sourceId, brandId, config }) => {

    const startTime = Date.now()

    try {

      const token = await getAccessToken(
        sourceId,
        config.auth.client_id,
        config.auth.client_secret
      )

      const graphqlQuery = `
        query GetTopPosts($limit: Int!) {
          posts(first: $limit, order: VOTES) {
            edges {
              node {
                id
                name
                website
                url
                votesCount
                makers {
                  name
                  username
                }
              }
            }
          }
        }
      `

      const response = await fetch(
        "https://api.producthunt.com/v2/api/graphql",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            query: graphqlQuery,
            variables: { limit: config.limit }
          })
        }
      )

      if (!response.ok) {

        if (response.status === 401) {
          tokenCache.delete(sourceId)
        }

        throw new DiscoveryError(
          `ProductHunt API failed: ${response.status}`,
          classifyHttpStatus(response.status)
        )
      }

      const json = await response.json()
      const edges = json?.data?.posts?.edges ?? []

      const companies = []
      const contacts = []

      for (const edge of edges) {

        if (companies.length >= PH_MAX_GLOBAL_ITEMS) {
          break
        }

        const transformed =
          transformProductHuntNode(
            edge.node,
            sourceId
          )

        if (transformed.company) {
          companies.push(transformed.company)
        }

        contacts.push(...transformed.contacts)
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
        "ProductHunt discovery completed"
      )

      const result: DiscoveryResult = {
        companies,
        contacts,
        meta: {
          executor: "producthunt",
          risk: "medium" as any,
          total_fetched: edges.length,
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
        err?.message ?? "ProductHunt executor failed",
        "retryable"
      )
    }
  }