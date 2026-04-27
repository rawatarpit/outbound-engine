import { z } from "zod"

export const EMAIL_FINDER_MAX_LIMIT = 50
export const EMAIL_FINDER_MAX_ITEMS = 100

export const emailFinderSchema = z.object({
  domain: z.string().min(1, "Domain is required"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  usePattern: z.boolean().default(true),
  limit: z
    .number()
    .int()
    .min(1)
    .max(EMAIL_FINDER_MAX_LIMIT)
    .default(20),
})

export type EmailFinderConfig = z.infer<typeof emailFinderSchema>