import pino from "pino"
import { PlaywrightCrawler } from "@crawlee/playwright"
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
import * as cheerio from "cheerio"

const logger = pino({ level: "info" })

const DEFAULT_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

const MAX_RETRIES = 2

function randomDelay(): number {
  return Math.floor(Math.random() * 3000) + 2000
}

export const indieHackersExecutor:
  Executor<IndieHackersConfig> =
  async ({ sourceId, brandId, config }) => {

    const startTime = Date.now()

    try {

      const parsed = indieHackersSchema.parse(config)
      let keywords = parsed.keywords || []
      
      if (keywords.length === 0 && parsed.query) {
        keywords = [parsed.query]
      }
      
      if (keywords.length === 0) {
        keywords = ["sales", "outbound", "b2b", "startup"]
      }

      const searchType = parsed.searchType || "posts"
      const userAgent = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]

      const rawProfiles: any[] = []

      for (const keyword of keywords.slice(0, 3)) {
        const url = `https://www.indiehackers.com/search?q=${encodeURIComponent(keyword)}`

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
              logger.warn({ url: request.url }, "Page load timeout")
            }

            const html = await page.content()
            const $ = cheerio.load(html)

            $("a[href*='/post/']").each((_i, el) => {
              const $el = $(el)
              const href = $el.attr("href") || ""
              const text = $el.text().trim()

              if (text && text.length > 3 && text.length < 150) {
                rawProfiles.push({
                  title: text,
                  url: href.startsWith("http") ? href : `https://www.indiehackers.com${href}`,
                  type: "post",
                  source: "indiehackers",
                })
              }
            })

            $("a[href*='/ask/']").each((_i, el) => {
              const $el = $(el)
              const href = $el.attr("href") || ""
              const text = $el.text().trim()

              if (text && text.length > 3 && text.length < 150) {
                rawProfiles.push({
                  title: text,
                  url: href.startsWith("http") ? href : `https://www.indiehackers.com${href}`,
                  type: "ask",
                  source: "indiehackers",
                })
              }
            })

            $("a[href*='/forum/']").each((_i, el) => {
              const $el = $(el)
              const href = $el.attr("href") || ""
              const text = $el.text().trim()

              if (text && text.length > 3 && text.length < 150) {
                rawProfiles.push({
                  title: text,
                  url: href.startsWith("http") ? href : `https://www.indiehackers.com${href}`,
                  type: "forum",
                  source: "indiehackers",
                })
              }
            })

            logger.info({ keyword, count: rawProfiles.length }, "IndieHackers keyword scrape complete")
          },

          failedRequestHandler({ request, log }) {
            log.error(`Request ${request.url} failed multiple times`)
          },
        })

        await crawler.run([url])
      }

      if (rawProfiles.length === 0) {
        throw new DiscoveryError(
          "SOURCE_EXTRACTION_FAILED: No IndieHackers results extracted",
          "retryable"
        )
      }

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
          duration_ms: duration,
          rawCount: rawProfiles.length
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

      if (err.message === "SOURCE_EXTRACTION_FAILED") {
        throw err
      }

      throw new DiscoveryError(
        err?.message ?? "IndieHackers executor failed",
        "retryable"
      )
    }
  }
