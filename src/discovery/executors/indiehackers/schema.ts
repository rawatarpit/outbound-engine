import { z } from "zod"

/* =========================================================
   HARD LIMITS
========================================================= */

export const IH_MAX_LIMIT = 100
export const IH_MAX_GLOBAL_ITEMS = 500

/* =========================================================
   CONFIG SCHEMA
========================================================= */

export const indieHackersSchema = z.object({
  query: z
    .string()
    .min(1)
    .optional(),

  limit: z
    .number()
    .int()
    .min(1)
    .max(IH_MAX_LIMIT)
    .default(50)
})

export type IndieHackersConfig =
  z.infer<typeof indieHackersSchema>