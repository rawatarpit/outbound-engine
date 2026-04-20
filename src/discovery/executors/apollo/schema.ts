import { z } from "zod"

/* =========================================================
   HARD LIMITS
========================================================= */

export const APOLLO_MAX_LIMIT = 100
export const APOLLO_MAX_PAGES = 10
export const APOLLO_MAX_GLOBAL_ITEMS = 500

/* =========================================================
   CONFIG SCHEMA
========================================================= */

export const apolloSchema = z.object({
  api_key: z
    .string()
    .min(10, "Apollo API key required"),

  query: z
    .string()
    .min(1)
    .optional(),

  page: z
    .number()
    .int()
    .min(1)
    .optional(),

  limit: z
    .number()
    .int()
    .min(1)
    .max(APOLLO_MAX_LIMIT)
    .default(50),

  max_pages: z
    .number()
    .int()
    .min(1)
    .max(APOLLO_MAX_PAGES)
    .default(3)
})

export type ApolloConfig = z.infer<typeof apolloSchema>