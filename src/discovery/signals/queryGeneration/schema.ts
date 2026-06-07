import { z } from "zod"

const ADAPTERS = [
  "search",
  "reddit",
  "hackernews",
  "news",
  "jobs",
  "blogs",
  "community",
  "github",
  "hn_hiring",
  "yc",
  "producthunt",
  "indeed",
  "crunchbase",
  "wellfound",
  "techcrunch",
  "pushshift",
  "stackshare",
] as const

const SIGNAL_VALUES = [
  "hiring", "pain", "funding", "automation_need",
  "tech_usage", "growth_activity", "partnership", "outbound_pain",
  "expansion", "migration", "compliance", "burnout",
] as const

function cleanAdapter(raw: unknown): string {
  const s = String(raw).trim().toLowerCase().replace(/[^a-z_]/g, "")
  if (ADAPTERS.includes(s as any)) return s
  return "search"
}

function cleanSignal(raw: string): string {
  const first = raw.split(",")[0].split("/")[0].trim().toLowerCase().replace(/[^a-z_]/g, "")
  if (SIGNAL_VALUES.includes(first as any)) return first
  return "pain"
}

function clampPriority(raw: unknown): number {
  const n = Number(raw)
  if (isNaN(n)) return 5
  return Math.max(1, Math.min(10, Math.round(n)))
}

export const GeneratedQuerySchema = z.object({
  adapter: z.string().min(1).transform(cleanAdapter),
  query: z.string().min(1).transform(v => v.length < 5 ? `${v} company` : v).pipe(z.string().min(5).max(200)),
  rationale: z.string().default(""),
  expected_signal: z.string().min(1).transform(cleanSignal),
  priority: z.number().min(1).default(5),
})

export const QueryGenerationOutputSchema = z.object({
  queries: z.array(GeneratedQuerySchema).min(1).max(20).transform(qs => qs.slice(0, 15)),
  reasoning: z.string().default(""),
  avoid_patterns: z.array(z.string()).default([]),
})

export type GeneratedQuery = z.infer<typeof GeneratedQuerySchema>
export type QueryGenerationOutput = z.infer<typeof QueryGenerationOutputSchema>
