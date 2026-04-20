import { z } from "zod"

/* =========================================================
   HARD LIMITS
========================================================= */

export const GITHUB_MAX_PER_PAGE = 100
export const GITHUB_MAX_PAGES = 10
export const GITHUB_MAX_GLOBAL_ITEMS = 500

/* =========================================================
   CONFIG SCHEMA
========================================================= */

export const githubSchema = z.object({
  query: z
    .string()
    .min(1, "GitHub query cannot be empty")
    .max(500),

  min_stars: z
    .number()
    .int()
    .nonnegative()
    .optional(),

  language: z
    .string()
    .min(1)
    .max(50)
    .optional(),

  per_page: z
    .number()
    .int()
    .min(1)
    .max(GITHUB_MAX_PER_PAGE)
    .default(30),

  max_pages: z
    .number()
    .int()
    .min(1)
    .max(GITHUB_MAX_PAGES)
    .default(3),

  github_token: z
    .string()
    .min(10)
    .optional()
})

export type GithubConfig = z.infer<typeof githubSchema>

/* =========================================================
   SAFE LIMIT CALCULATOR
========================================================= */

export function computeSafeGithubLimit(
  config: GithubConfig
): number {
  const theoreticalMax =
    config.per_page * config.max_pages

  return Math.min(
    theoreticalMax,
    GITHUB_MAX_GLOBAL_ITEMS
  )
}