import { SignalType } from "./types"
import type { BrandProfile } from "../../db/supabase"

const SIGNAL_QUERY_TEMPLATES: Record<string, string[]> = {
  hiring: [
    "hiring sales rep",
    "hiring sales team",
    "need sales rep",
  ],
  hiring_sales: [
    "hiring account executive",
    "hiring sales closer",
    "need sales representative",
  ],
  hiring_engineer: [
    "hiring developer",
    "hiring engineer",
    "need developer",
  ],
  remote_hiring: [
    "remote jobs",
    "remote sales",
    "work from home",
  ],
  hiring_agency: [
    "hiring marketing agency",
    "need growth agency",
  ],
  funding: [
    "raised seed round",
    "series funding",
    "got funding",
  ],
  funding_announcement: [
    "raised seed",
    "announced funding",
  ],
  acquisition: [
    "acquired",
  ],
  launch: [
    "launched new product",
    "new feature",
  ],
  product_launch: [
    "new product",
    "public beta",
  ],
  pain: [
    "need help with pipeline",
    "outbound not working",
    "lead gen help",
  ],
  advertising: [
    "google ads",
    "marketing agency",
  ],
  partnership: [
    "seeking partners",
  ],
  tech_usage: [
    "using sales tool",
    "best CRM",
  ],
  growth_activity: [
    "hired sales team",
    "scaling revenue",
  ],
  expansion: [
    "expanding team",
    "scaling",
  ],
  team_growth: [
    "growing team",
    "hiring fast",
  ],
}

const SITE_FILTERS = [
  "site:linkedin.com",
  "site:twitter.com",
  "site:reddit.com",
  "site:news",
]

const HIGH_INTENT_PHRASES = [
  "looking for",
  "need help with",
  "alternatives to",
  "hiring",
  "using",
  "problem with",
  "best tool for",
  "recommend",
  "vs ",
  "frustrated with",
  "tired of",
]

const RECENCY_MODIFIERS = ["2026", "recent", "latest", "this year"]

const ROLE_ALTERNATIVES: Record<string, string[]> = {
  "sales representative": ["sales rep", "account executive", "sales executive", "business development rep"],
  marketing: ["growth marketer", "performance marketer", "demand generation", "marketing manager"],
  founder: ["founder", "ceo", "co-founder", "cto"],
}

const PAIN_POINT_TEMPLATES = [
  "lead generation",
  "outbound sales",
  "cold calling",
  "email outreach",
  "prospecting",
  "conversion rates",
  "winning deals",
  "pipeline",
  "closing deals",
]

const TECH_KEYWORDS = [
  "salesforce",
  "hubspot",
  "mailchimp",
  "zoom",
  "slack",
  "intercom",
  "drift",
  "clearbit",
  "apollo",
  "hunter",
]

export interface QueryGeneratorConfig {
  product: string
  positioning?: string | null
  coreOffer?: string | null
  audience?: string | null
  painPoints?: string | null
}

export function generateQueries(
  signal: string,
  brand: QueryGeneratorConfig,
  useSiteFilters: boolean = false,
): string[] {
  const templates = SIGNAL_QUERY_TEMPLATES[signal]
  if (!templates || templates.length === 0) {
    return []
  }

  const queries: string[] = []

  for (const template of templates.slice(0, 3)) {
    // Simple substitution - no complex placeholders
    let query = template
      .replace("{role}", "sales rep")
      .replace("{audience}", brand.audience || "B2B")
      .replace("{product}", brand.product || "software")
      .replace("{pain_point}", "pipeline")
      .replace("{tech}", "HubSpot")
      .replace("{round}", "A")
    
    query = query.replace(/\s+/g, " ").trim()
    if (query.length > 3) {
      queries.push(query)
    }
  }

  return queries.slice(0, 5)
}

function substituteTemplate(
  template: string,
  vars: Record<string, string | undefined | null>,
): string {
  let result = template

  for (const [key, value] of Object.entries(vars)) {
    if (!value) continue

    const placeholders = [
      `{${key}}`,
      `{${key}_variant}`,
    ]

    for (const placeholder of placeholders) {
      if (result.includes(placeholder)) {
        result = result.replace(placeholder, value)
      }
    }
  }

  if (result.includes("{pain_point}")) {
    const pain = PAIN_POINT_TEMPLATES[Math.floor(Math.random() * PAIN_POINT_TEMPLATES.length)]
    result = result.replace("{pain_point}", pain)
  }

  if (result.includes("{tech}")) {
    const tech = TECH_KEYWORDS[Math.floor(Math.random() * TECH_KEYWORDS.length)]
    result = result.replace("{tech}", tech)
  }

  if (result.includes("{round}")) {
    const rounds = ["A", "B", "C"]
    const round = rounds[Math.floor(Math.random() * rounds.length)]
    result = result.replace("{round}", round)
  }

  result = result.replace(/\{[a-z_]+\}/g, "")

  result = result.replace(/\s+/g, " ").trim()

  const trimmed = result.replace(/^[,. ]+|[,. ]+$/g, "")
  return trimmed
}

function selectRoleVariant(positioning?: string | null): string {
  if (!positioning) return "sales representative"

  const lower = positioning.toLowerCase()

  for (const [role, variants] of Object.entries(ROLE_ALTERNATIVES)) {
    if (lower.includes(role)) {
      return variants[Math.floor(Math.random() * variants.length)]
    }
  }

  return "sales representative"
}

export function generateSignalQueriesForBrand(
  brand: BrandProfile,
  signals: string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>()

  const config: QueryGeneratorConfig = {
    product: brand.product,
    positioning: brand.positioning,
    coreOffer: brand.core_offer,
    audience: brand.audience,
    painPoints: brand.objection_guidelines,
  }

  for (const signal of signals) {
    const queries = generateQueries(signal, config)
    result.set(signal, queries)
  }

  return result
}