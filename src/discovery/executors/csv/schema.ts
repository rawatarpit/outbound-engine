import { z } from "zod"

/* =========================================================
   HARD LIMITS
========================================================= */

export const CSV_MAX_ROWS = 10_000
export const CSV_MAX_GLOBAL_ITEMS = 500

/* =========================================================
   CONFIG SCHEMA
========================================================= */

export const csvSchema = z.object({
  file_path: z
    .string()
    .min(1, "CSV file path required"),

  column_map: z.object({
    name: z.string().optional(),
    domain: z.string(),
    email: z.string().optional()
  })
})

export type CsvConfig = z.infer<typeof csvSchema>