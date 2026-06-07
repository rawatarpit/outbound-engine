import pino from "pino"
import type { BrandIntent } from "../../db/supabase"

const logger = pino({ level: "debug" })

export interface SearchQuery {
  query: string
  intent_id: string
  signal: string
  source: "google" | "reddit" | "hackernews" | "news" | "jobs" | "freelance" | "blogs" | "community"
}

const SIGNAL_QUERY_TEMPLATES: Record<string, Record<string, string[]>> = {
  google: {
    hiring: [
      "hiring {keyword} sales",
      "{keyword} looking for sales manager",
      "{keyword} job openings sales development",
    ],
    funding: [
      "{keyword} raises funding",
      "{keyword} series seed round",
      "{keyword} investment growth",
    ],
    launch: [
      "{keyword} launched new product",
      "{keyword} just launched",
      "{keyword} product release",
    ],
    pain: [
      "{keyword} struggling with",
      "{keyword} challenges",
      "{keyword} alternatives",
    ],
    tool_search: [
      "best {keyword} tools",
      "{keyword} recommendations",
      "what {keyword} do you use",
    ],
    partnership: [
      "{keyword} partnership",
      "{keyword} strategic partner",
      "{keyword} integration",
    ],
    expansion: [
      "{keyword} expanding team",
      "{keyword} new office",
      "{keyword} scaling",
    ],
    growth_activity: [
      "{keyword} growth",
      "{keyword} scaling",
      "{keyword} hiring",
    ],
    outbound_pain: [
      "{keyword} struggling with outbound",
      "{keyword} cold email not working",
      "{keyword} lead generation problem",
      "{keyword} sales prospecting challenge",
    ],
    automation_need: [
      "{keyword} sales automation",
      "{keyword} automating outreach",
      "{keyword} lead gen automation",
      "{keyword} sales tools",
    ],
    tech_usage: [
      "{keyword} using",
      "{keyword} stack",
      "{keyword} technology",
    ],
  },
  reddit: {
    pain: [
      "{keyword} site:reddit.com struggling",
      "{keyword} site:reddit.com help",
      "{keyword} site:reddit.com problem",
    ],
    tool_search: [
      "recommend {keyword} site:reddit.com",
      "best {keyword} site:reddit.com",
      "looking for {keyword} site:reddit.com",
    ],
    hiring: [
      "hiring {keyword} site:reddit.com",
      "looking to hire {keyword} site:reddit.com",
    ],
    outbound_pain: [
      "outbound sales {keyword} site:reddit.com",
      "cold email {keyword} site:reddit.com",
      "lead generation {keyword} site:reddit.com",
    ],
    automation_need: [
      "sales automation {keyword} site:reddit.com",
      "outbound tool {keyword} site:reddit.com",
    ],
  },
  hackernews: {
    launch: [
      "{keyword} show hn",
      "{keyword} launch",
    ],
    hiring: [
      "{keyword} hiring",
      "{keyword} who is hiring",
    ],
    funding: [
      "{keyword} raised",
      "{keyword} series",
    ],
  },
  news: {
    funding: [
      "{keyword} raises series",
      "{keyword} funding round",
      "{keyword} raises seed",
    ],
    partnership: [
      "{keyword} partnership announced",
      "{keyword} strategic partner",
      "{keyword} integration",
    ],
    launch: [
      "{keyword} launches new",
      "{keyword} product launch",
      "{keyword} debuted",
    ],
    expansion: [
      "{keyword} expands to",
      "{keyword} new office",
      "{keyword} opens in",
    ],
    growth_activity: [
      "{keyword} growth",
      "{keyword} hiring spree",
      "{keyword} acquisition",
    ],
  },
  jobs: {
    hiring: [
      "{keyword} hiring",
      "{keyword} job opening",
      "{keyword} careers",
      "{keyword} we are hiring",
      "{keyword} looking for",
    ],
    growth_activity: [
      "{keyword} startup hiring",
      "{keyword} building team",
      "{keyword} scaling",
    ],
    funding: [
      "{keyword} hiring after funding",
      "{keyword} series a hiring",
      "{keyword} seed round team",
    ],
    outbound_pain: [
      "{keyword} sales development representative",
      "{keyword} bdr hiring",
      "{keyword} outbound sales job",
    ],
  },
  freelance: {
    hiring: [
      "need {keyword} developer freelancer",
      "looking for {keyword} expert hire",
      "urgent {keyword} project freelancer",
      "hire {keyword} specialist upwork",
    ],
    pain: [
      "need help with {keyword}",
      "struggling with {keyword} need freelancer",
      "{keyword} automation help needed",
      "looking for {keyword} solution",
    ],
    automation_need: [
      "need {keyword} automation freelancer",
      "automate {keyword} process hire",
      "build {keyword} system freelancer",
      "custom {keyword} tool development",
    ],
    tool_search: [
      "looking for {keyword} developer",
      "need {keyword} expert build",
      "hire {keyword} consultant",
      "find {keyword} specialist",
    ],
  },
  blogs: {
    pain: [
      "{keyword} challenges solution",
      "{keyword} problems scaling",
      "struggling with {keyword}",
      "{keyword} lessons learned",
    ],
    tech_usage: [
      "how we use {keyword}",
      "building with {keyword}",
      "{keyword} implementation guide",
      "{keyword} best practices",
    ],
    automation_need: [
      "automating {keyword} workflow",
      "{keyword} automation case study",
      "why we automated {keyword}",
      "how to automate {keyword}",
    ],
  },
  community: {
    pain: [
      "{keyword} help needed",
      "{keyword} problem advice",
      "{keyword} struggling recommendations",
      "{keyword} issue need solution",
    ],
    tool_search: [
      "best {keyword} tool recommendation",
      "looking for {keyword} service",
      "{keyword} alternatives suggestions",
      "recommend {keyword} platform",
    ],
    hiring: [
      "need {keyword} developer hire",
      "looking to hire {keyword} engineer",
      "find {keyword} expert recommended",
      "freelance {keyword} project help",
    ],
    automation_need: [
      "automate {keyword} workflow",
      "build {keyword} system advice",
      "{keyword} automation tool stack",
    ],
  },
}

export function generateQueries(
  intents: BrandIntent[],
  keywords: string[]
): SearchQuery[] {
  const queries: SearchQuery[] = []

  for (const intent of intents) {
    if (!intent.is_active) continue

    // Use custom search_queries if available, otherwise fall back to template generation
    if (intent.search_queries && intent.search_queries.length > 0) {
      // Use predefined search queries
      for (const queryText of intent.search_queries) {
        // Distribute across sources evenly
        const sources = ["google", "reddit", "hackernews", "news", "jobs", "freelance", "blogs", "community"] as const
        const sourceIndex = queries.length % sources.length
        const source = sources[sourceIndex]
        
        queries.push({
          query: queryText,
          intent_id: intent.id,
          signal: intent.signals[0] || "pain", // Use first signal as default
          source,
        })
      }
    } else {
      // Fall back to template-based generation
      for (const signal of intent.signals) {
        for (const sourceType of ["google", "reddit", "hackernews", "news", "jobs", "freelance", "blogs", "community"] as const) {
          const templates = SIGNAL_QUERY_TEMPLATES[sourceType]?.[signal]
          if (!templates) continue

          for (const keyword of keywords.slice(0, 5)) {
            for (const template of templates) {
              const query = template.replace(/\{keyword\}/g, keyword)
              queries.push({
                query,
                intent_id: intent.id,
                signal,
                source: sourceType,
              })
            }
          }
        }
      }
    }
  }

  logger.info({ count: queries.length }, "Generated discovery queries")
  return queries
}
