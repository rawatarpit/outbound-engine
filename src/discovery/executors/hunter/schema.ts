import { z } from "zod"

/* =========================================================
   HARD LIMITS
========================================================= */

export const HUNTER_MAX_LIMIT = 100
export const HUNTER_MAX_GLOBAL_ITEMS = 500

/* =========================================================
   CONFIG SCHEMA
========================================================= */

export const hunterSchema = z.object({
  api_key: z
    .string()
    .min(10, "Hunter API key is required"),

  domain: z
    .string()
    .min(1)
    .optional(),

  company: z
    .string()
    .min(1)
    .optional(),

  limit: z
    .number()
    .int()
    .min(1)
    .max(HUNTER_MAX_LIMIT)
    .default(50)
}).refine(
  (data) => data.domain || data.company,
  {
    message: "Either domain or company must be provided"
  }
)

export type HunterConfig = z.infer<typeof hunterSchema>