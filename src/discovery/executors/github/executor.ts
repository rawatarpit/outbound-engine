import pino from "pino"
import { z } from "zod"
import type { Executor } from "../../registry"
import type {
  DiscoveryResult,
  DiscoveryCompany,
  DiscoveryRisk
} from "../../types"
import { normalizeDomain } from "../../normalizer"
import {
  DiscoveryError,
  classifyHttpStatus
} from "../../errors"

const logger = pino({ level: "info" })

const MAX_GLOBAL_ITEMS = 500

/* =========================================================
   SCHEMA
========================================================= */

export const githubSchema = z.object({
  query: z.string().min(1),
  min_stars: z.number().optional(),
  language: z.string().optional(),
  per_page: z.number().max(100).optional().default(30),
  max_pages: z.number().max(10).optional().default(3),
  github_token: z.string().optional()
})

export type GithubConfig = z.infer<typeof githubSchema>

/* =========================================================
   EXECUTOR
========================================================= */

export const githubExecutor: Executor<GithubConfig> =
  async ({ sourceId, brandId, config }) => {

    const startTime = Date.now()

    const companies: DiscoveryCompany[] = []

    let totalFetched = 0
    let rateLimited = false

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json"
    }

    if (config.github_token) {
      headers["Authorization"] = `Bearer ${config.github_token}`
    }

    try {
      for (let page = 1; page <= config.max_pages; page++) {

        if (companies.length >= MAX_GLOBAL_ITEMS) break

        const queryParts = [config.query]

        if (config.min_stars) {
          queryParts.push(`stars:>=${config.min_stars}`)
        }

        if (config.language) {
          queryParts.push(`language:${config.language}`)
        }

        const query = queryParts.join(" ")

        const url = new URL(
          "https://api.github.com/search/repositories"
        )

        url.searchParams.set("q", query)
        url.searchParams.set("sort", "stars")
        url.searchParams.set("order", "desc")
        url.searchParams.set("per_page", String(config.per_page))
        url.searchParams.set("page", String(page))

        const res = await fetch(url.toString(), { headers })

        if (!res.ok) {
          const text = await res.text()
          const failureType = classifyHttpStatus(res.status)

          throw new DiscoveryError(
            `GitHub API error: ${res.status} - ${text}`,
            failureType,
            {
              metadata: { status: res.status }
            }
          )
        }

        const remaining = res.headers.get("x-ratelimit-remaining")
        const reset = res.headers.get("x-ratelimit-reset")

        if (remaining === "0" && reset) {
          rateLimited = true

          const waitMs =
            Number(reset) * 1000 - Date.now()

          if (waitMs > 0 && waitMs < 60_000) {
            await new Promise((r) =>
              setTimeout(r, waitMs)
            )
          } else {
            throw new DiscoveryError(
              "GitHub rate limit exceeded",
              "retryable"
            )
          }
        }

        const data = await res.json()

        if (!data.items?.length) break

        totalFetched += data.items.length

        for (const repo of data.items) {

          if (companies.length >= MAX_GLOBAL_ITEMS) break
          if (!repo.homepage) continue

          const domain = normalizeDomain(repo.homepage)
          if (!domain) continue

          companies.push({
            name: repo.owner?.login ?? repo.name,
            domain,

            source: sourceId,
            source_url: repo.html_url,

            // 🔥 Use correct enum/value from your types
            risk: "MODERATE_PUBLIC" as DiscoveryRisk,

            confidence: 0.7,

            intent_score: repo.stargazers_count
              ? Math.min(repo.stargazers_count / 10000, 1)
              : 0.1,

            requires_enrichment: true,

            raw: repo
          })
        }
      }

      const duration = Date.now() - startTime

      const result: DiscoveryResult = {
        companies,
        contacts: [],
        meta: {
          executor: "github",

          // 🔥 REQUIRED FIELD
          risk: "MODERATE_PUBLIC" as DiscoveryRisk,

          total_fetched: totalFetched,
          total_companies: companies.length,
          rate_limited: rateLimited,
          source_health: rateLimited
            ? "degraded"
            : "healthy",
          duration_ms: duration
        }
      }

      return result

    } catch (err: any) {

      if (err instanceof DiscoveryError) {
        throw err
      }

      throw new DiscoveryError(
        err?.message ?? "GitHub executor failed",
        "retryable"
      )
    }
  }