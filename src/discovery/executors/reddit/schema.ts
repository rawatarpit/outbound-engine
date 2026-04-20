import { z } from "zod"

export const redditSchema = z.object({
  keywords: z
    .array(z.string().min(2))
    .min(1, "At least one keyword required"),

  subreddits: z
    .array(z.string().min(2))
    .min(1, "At least one subreddit required"),

  sort: z.enum(["relevance", "hot", "new", "top", "comments"])
    .default("new"),

  time: z.enum(["hour", "day", "week", "month", "year", "all"])
    .default("month"),

  limit: z.number().min(1).max(100).default(25),

  minScore: z.number().min(0).max(1).default(0),

  includeNSFW: z.boolean().default(false)
})

export type RedditConfig = z.infer<typeof redditSchema>