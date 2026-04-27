import { z } from "zod"

export const JOBSPY_MAX_LIMIT = 100
export const JOBSPY_MAX_ITEMS = 200

export const jobSpySchema = z.object({
  keywords: z.string().min(1, "Keywords are required"),
  location: z.string().optional(),
  site: z.enum(["linkedin", "indeed", "glassdoor", "all"]).default("all"),
  recentDays: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(7),
  limit: z
    .number()
    .int()
    .min(1)
    .max(JOBSPY_MAX_LIMIT)
    .default(50),
})

export type JobSpyConfig = z.infer<typeof jobSpySchema>