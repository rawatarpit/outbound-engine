import { SignalType } from "./types"
import type { BrandProfile } from "../../db/supabase"

const SIGNAL_QUERY_TEMPLATES: Record<string, string[]> = {
  hiring: [
    "hiring {role} {audience}",
    "looking for {role} {audience}",
    "{audience} hiring sales team",
    "hiring b2b sales rep",
    "hiring outbound sales",
    "vacancies {role} {audience}",
    "job opening {role} {audience}",
    "seeking {role} {audience}",
  ],
  hiring_sales: [
    "hiring sales representative {audience}",
    "looking for account executive",
    "hiring b2b sales close",
    "hiring sales development rep",
    "hiring revenue team {audience}",
    "seeking outbound sales {audience}",
    "need sales rep {audience}",
  ],
  hiring_engineer: [
    "hiring senior engineer {audience}",
    "looking for full stack developer",
    "hiring backend engineer {audience}",
    "seeking devops engineer",
    "hiring frontend developer {audience}",
    "need software engineer {audience}",
  ],
  remote_hiring: [
    "remote hiring {role} {audience}",
    "remote jobs {role}",
    "work from home hiring {audience}",
    "distributed team hiring {audience}",
    "anywhere hiring {role}",
    "remote-first company hiring",
  ],
  hiring_agency: [
    "hiring marketing agency {audience}",
    "looking for growth agency",
    "need b2b marketing partner",
    "seeking lead gen agency",
  ],
  funding: [
    "raised seed round {audience}",
    "Series A funding {audience}",
    "venture capital {audience}",
    "recent funding round {audience}",
    "secured funding {audience}",
    "Series {round} {audience}",
  ],
  funding_announcement: [
    "{audience} raised {round} funding",
    "announcing ${round}M round {audience}",
    "{audience} gets new investment",
    "{audience} secures {round} million",
    "just raised {audience} seed",
    "{audience} venture round",
  ],
  acquisition: [
    "{audience} acquired",
    "{audience} acquisition",
    "{audience} acquired by",
    "acquired company {audience}",
  ],
  launch: [
    "launched new product {audience}",
    "just launched {audience}",
    "announcing new {product} {audience}",
    "public beta {audience}",
    "new feature release {audience}",
  ],
  product_launch: [
    "new {product} launch {audience}",
    "{audience} launching {product}",
    "{audience} public launch",
    "{audience} new release",
    "{audience} beta access",
  ],
  pain: [
    "struggling with {pain_point}",
    "tired of {pain_point}",
    "problem with {pain_point}",
    "looking for {pain_point} solution",
    "frustrated with {pain_point}",
    "need help with {pain_point}",
    "can't find {pain_point}",
    "hard to {pain_point}",
    "best way to {pain_point}",
  ],
  advertising: [
    "running google ads",
    "hiring marketing agency",
    "facebook ads agency",
    "b2b advertising {audience}",
    "growth marketing {audience}",
    "performance marketing {audience}",
    "google ads management {audience}",
    "linkedin ads {audience}",
  ],
  partnership: [
    "looking for partners {audience}",
    "seeking channel partners",
    "partnership program {audience}",
    "reseller program {audience}",
    "partner with {audience}",
    "seeking referral partners",
    "partner integration {audience}",
  ],
  tech_usage: [
    "using {tech} for {audience}",
    "implemented {tech} {audience}",
    "built with {tech}",
    "{tech} platform {audience}",
    "switched to {tech} {audience}",
    "{tech} for sales {audience}",
    "best {tech} alternative",
  ],
  growth_activity: [
    "scaling outbound {audience}",
    "hired sales team {audience}",
    "expanding sales team {audience}",
    "hiring b2b sales {audience}",
    "growing revenue {audience}",
    "100% growth year over year {audience}",
    "scaling team {audience}",
  ],
  expansion: [
    "expanding to new markets {audience}",
    "new market entry {audience}",
    "scaling internationally {audience}",
    "moving to new market {audience}",
    "opening new office {audience}",
  ],
  team_growth: [
    "growing team {audience}",
    "scaling team {audience}",
    "hiring spurt {audience}",
    " doubling team {audience}",
    "rapid team growth {audience}",
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
  useSiteFilters: boolean = true,
): string[] {
  const templates = SIGNAL_QUERY_TEMPLATES[signal]
  if (!templates || templates.length === 0) {
    return []
  }

  const siteFilter = useSiteFilters
    ? SITE_FILTERS[Math.floor(Math.random() * SITE_FILTERS.length)]
    : null

  const queries: string[] = []

  for (const template of templates) {
    const query = substituteTemplate(template, {
      product: brand.product,
      positioning: brand.positioning,
      coreOffer: brand.coreOffer,
      audience: brand.audience,
      painPoint: brand.painPoints,
      role: selectRoleVariant(brand.positioning),
    })

    if (!query) continue

    if (siteFilter) {
      queries.push(`${query} ${siteFilter}`)
    } else {
      queries.push(query)
    }

    const withRecency = `${query} ${RECENCY_MODIFIERS[Math.floor(Math.random() * RECENCY_MODIFIERS.length)]}`
    queries.push(withRecency)

    const withIntent = `${HIGH_INTENT_PHRASES[Math.floor(Math.random() * HIGH_INTENT_PHRASES.length)]} ${query}`
    queries.push(withIntent)
  }

  const deduplicated = [...new Set(queries)]
  return deduplicated.slice(0, 25)
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