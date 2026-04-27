import pino from "pino"
import { PlaywrightCrawler } from "@crawlee/playwright"
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
import * as cheerio from "cheerio"

const logger = pino({ level: "info" })

type TokenCacheEntry = {
  token: string
  expiresAt: number
}

const tokenCache = new Map<string, TokenCacheEntry>()

const DEFAULT_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

const MAX_RETRIES = 2

function randomDelay(): number {
  return Math.floor(Math.random() * 3000) + 2000
}

async function getAccessToken(
  sourceId: string,
  clientId: string,
  clientSecret: string
): Promise<string | null> {

  const existing = tokenCache.get(sourceId)

  if (existing && existing.expiresAt > Date.now()) {
    return existing.token
  }

  if (!clientId || !clientSecret) {
    return null
  }

  try {
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
      return null
    }

    const json = await response.json()

    const token = json.access_token
    const expiresIn = json.expires_in ?? 3600

    tokenCache.set(sourceId, {
      token,
      expiresAt: Date.now() + (expiresIn - 60) * 1000
    })

    return token
  } catch (err) {
    logger.warn({ error: err }, "ProductHunt token fetch failed")
    return null
  }
}

async function scrapeWithBrowser(
  config: ProductHuntConfig,
  sourceId: string,
): Promise<any[]> {
  const results: any[] = []
  const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]
  const limit = config.limit || 20

  const url = `https://www.producthunt.com/search?q=${encodeURIComponent(config.query || "")}&limit=${limit}`

  const crawler = new PlaywrightCrawler({
    maxConcurrency: 1,
    maxRequestRetries: MAX_RETRIES,

    preNavigationHooks: [
      async ({ page }) => {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
        })
      }
    ],

    launchContext: {
      launchOptions: {
        headless: true,
        userAgent: userAgent,
      },
    },

    async requestHandler({ page, request }) {
      const delay = randomDelay()
      await page.waitForTimeout(delay)

      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.google.com/',
      })

      await page.setViewportSize({ width: 1920, height: 1080 })

      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 20000 })
        await page.waitForTimeout(2000)
      } catch {
        logger.warn({ url: request.url }, "ProductHunt page load timeout")
      }

      const html = await page.content()
      const $ = cheerio.load(html)

      $("a[href*='/products/']").each((_i, el) => {
        const $el = $(el)
        const href = $el.attr("href") || ""
        const text = $el.text().trim()
        
        if (text && text.length > 2 && text.length < 100) {
          results.push({
            name: text,
            url: href.startsWith("http") ? href : `https://www.producthunt.com${href}`,
            website: "",
            votesCount: 0,
            makers: [],
          })
        }
      })

      $("h3, [data-testid='product-name']").each((_i, el) => {
        const $el = $(el)
        const text = $el.text().trim()
        const parent = $el.closest("a")
        const href = parent.attr("href") || ""

        if (text && text.length > 2 && text.length < 100 && !results.find(r => r.name === text)) {
          results.push({
            name: text,
            url: href.startsWith("http") ? href : `https://www.producthunt.com${href}`,
            website: "",
            votesCount: 0,
            makers: [],
          })
        }
      })

      logger.info({ count: results.length }, "ProductHunt browser scrape complete")
    },

    failedRequestHandler({ request, log }) {
      logger.warn(`ProductHunt request ${request.url} failed`)
    },
  })

  try {
    await crawler.run([url])
  } catch (err) {
    logger.error({ error: err }, "ProductHunt browser scrape failed")
  }

  return results
}

export const productHuntExecutor:
  Executor<ProductHuntConfig> =
  async ({ sourceId, brandId, config }) => {

    const startTime = Date.now()

    let edges: any[] = []
    let sourceHealth: "healthy" | "degraded" | "blocked" = "healthy"

    try {
      const parsed = productHuntSchema.parse(config)

      if (parsed.auth?.client_id && parsed.auth?.client_secret) {
        const token = await getAccessToken(
          sourceId,
          parsed.auth.client_id,
          parsed.auth.client_secret
        )

        if (token) {
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
                variables: { limit: parsed.limit }
              })
            }
          )

          if (!response.ok) {
            if (response.status === 401) {
              tokenCache.delete(sourceId)
            }
            if (response.status === 403 || response.status === 429) {
              sourceHealth = "blocked"
              logger.warn({ status: response.status }, "ProductHunt API blocked, falling back to browser")
            }
          } else {
            const json = await response.json()
            edges = json?.data?.posts?.edges ?? []
          }
        }
      }

      if (edges.length === 0) {
        logger.info("ProductHunt API failed or blocked, using browser fallback")
        sourceHealth = "degraded"
        edges = await scrapeWithBrowser(parsed, sourceId)
      }

      if (edges.length === 0) {
        throw new DiscoveryError(
          "SOURCE_EXTRACTION_FAILED: No ProductHunt results extracted",
          "retryable"
        )
      }

      const companies = []
      const contacts = []

      for (const edge of edges) {

        if (companies.length >= PH_MAX_GLOBAL_ITEMS) {
          break
        }

        const transformed =
          transformProductHuntNode(
            edge.node || edge,
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
          risk: "MODERATE_PUBLIC" as any,
          total_fetched: edges.length,
          total_companies: companies.length,
          total_contacts: contacts.length,
          source_health: sourceHealth,
          duration_ms: duration
        }
      }

      return result

    } catch (err: any) {

      if (err instanceof DiscoveryError) {
        throw err
      }

      if (err.message === "SOURCE_EXTRACTION_FAILED") {
        throw err
      }

      throw new DiscoveryError(
        err?.message ?? "ProductHunt executor failed",
        "retryable"
      )
    }
  }
