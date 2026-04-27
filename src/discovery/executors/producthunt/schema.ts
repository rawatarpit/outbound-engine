import { z } from "zod"

/* =========================================================
   HARD LIMITS
========================================================= */

export const PH_MAX_LIMIT = 100
export const PH_MAX_GLOBAL_ITEMS = 500

/* =========================================================
   CONFIG SCHEMA
========================================================= */

export const productHuntSchema = z.object({
  query: z
    .string()
    .min(1)
    .optional(),
  auth: z.object({
    client_id: z.string().min(5).optional(),
    client_secret: z.string().min(5).optional()
  }).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(PH_MAX_LIMIT)
    .default(20),
})

export type ProductHuntConfig =
  z.infer<typeof productHuntSchema>