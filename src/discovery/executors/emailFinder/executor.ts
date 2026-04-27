import axios from "axios"
import cheerio from "cheerio"
import pino from "pino"
import type { Executor, BatchExecutor } from "../../registry"
import type { DiscoveryResult } from "../../types"
import { DiscoveryError } from "../../errors"
import { z } from "zod"

const logger = pino({ level: "info" })

export const EMAIL_FINDER_MAX_ITEMS = 100

export const emailFinderSchema = z.object({
  domain: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  usePattern: z.boolean().default(true),
  limit: z.number().int().min(1).max(50).default(20),
})

export type EmailFinderConfig = z.infer<typeof emailFinderSchema>

interface EmailCandidate {
  email: string
  pattern: string
  confidence: number
}

const EMAIL_PATTERNS = [
  "{first}.{last}",
  "{first}{last}",
  "{first}.{last}@{domain}",
  "{first}_{last}",
  "{first}{last}@{domain}",
  "{first[0]}{last}",
  "{first[0]}.{last}",
  "{first}{last[0]}",
  "{last}.{first}",
  "{last}{first}",
]

function generateEmailPatterns(firstName: string, lastName: string, domain: string): string[] {
  const normalized = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "")
  const fn = normalized(firstName)
  const ln = normalized(lastName)
  const d = domain.toLowerCase()

  return EMAIL_PATTERNS.map((pattern) =>
    pattern
      .replace("{first}", fn)
      .replace("{last}", ln)
      .replace("{first[0]}", fn[0] || "")
      .replace("{last[0]}", ln[0] || "")
      .replace("{domain}", d)
  ).filter((e) => e.includes("@"))
}

async function scrapeEmailsFromWeb(domain: string): Promise<EmailCandidate[]> {
  const candidates: EmailCandidate[] = []
  const pages = [
    `https://${domain}`,
    `https://${domain}/about`,
    `https://${domain}/contact`,
    `https://${domain}/team`,
  ]

  for (const url of pages) {
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        },
      })

      const $ = cheerio.load(response.data)
      const text = $("body").text()
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
      const found = text.match(emailRegex) || []

      for (const email of found) {
        if (email.includes(domain) && !candidates.find((c) => c.email === email)) {
          candidates.push({ email, pattern: "scraped", confidence: 0.7 })
        }
      }
    } catch {
      // Continue to next page
    }
  }

  return candidates
}

export const emailFinderExecutor: BatchExecutor<EmailFinderConfig> =
  async ({ sourceId, brandId, config }, onBatch, batchSize = 10) => {
    const startTime = Date.now()

    try {
      const candidates: EmailCandidate[] = []

      const scraped = await scrapeEmailsFromWeb(config.domain)
      candidates.push(...scraped)

      if (config.usePattern && (config.firstName || config.lastName)) {
        const firstName = config.firstName || ""
        const lastName = config.lastName || ""
        const patterns = generateEmailPatterns(firstName, lastName, config.domain)

        for (const email of patterns) {
          if (!candidates.find((c) => c.email === email)) {
            candidates.push({ email, pattern: "generated", confidence: 0.4 })
          }
        }
      }

      const safeCandidates = candidates.slice(0, EMAIL_FINDER_MAX_ITEMS)
      const contacts = safeCandidates.map((c) => ({
        source_id: sourceId,
        brand_id: brandId,
        email: c.email,
        email_verified: c.confidence > 0.6,
        email_pattern: c.pattern,
        email_confidence: c.confidence,
        domain: config.domain,
        first_name: config.firstName || null,
        last_name: config.lastName || null,
      }))

      for (let i = 0; i < contacts.length; i += batchSize) {
        const batch = contacts.slice(i, i + batchSize)
        await onBatch({
          companies: [],
          contacts: batch as any,
          meta: {} as any,
        })
        logger.info({ stage: "EMAIL_FINDER_BATCH", batch: Math.floor(i / batchSize) + 1, count: batch.length })
      }

      const duration = Date.now() - startTime
      logger.info({
        sourceId,
        brandId,
        domain: config.domain,
        candidates: contacts.length,
        scraped: scraped.length,
        duration_ms: duration,
      }, "Email finder completed (streaming)")

    } catch (err: any) {
      throw new DiscoveryError(err?.message ?? "Email finder executor failed", "retryable")
    }
  }