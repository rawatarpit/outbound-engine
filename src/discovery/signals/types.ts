/**
 * ===============================
 * Signal Types (Universal)
 * ===============================
 */
export const SignalType = {
  HIRING: "hiring",
  FUNDING: "funding",
  LAUNCH: "launch",
  PAIN: "pain",
  ADVERTISING: "advertising",
  PARTNERSHIP: "partnership",
  TECH_USAGE: "tech_usage",
  GROWTH_ACTIVITY: "growth_activity",
  EXPANSION: "expansion",
  HIRING_ENGINEER: "hiring_engineer",
  HIRING_SALES: "hiring_sales",
  PRODUCT_LAUNCH: "product_launch",
  TEAM_GROWTH: "team_growth",
  REMOTE_HIRING: "remote_hiring",
  FUNDING_ANNOUNCEMENT: "funding_announcement",
  ACQUISITION: "acquisition",
  HIRING_AGENCY: "hiring_agency",
  OUTBOUND_PAIN: "outbound_pain",
  AUTOMATION_NEED: "automation_need",
} as const

export type SignalType = typeof SignalType[keyof typeof SignalType]

export const SIGNAL_WEIGHTS: Record<string, number> = {
  hiring: 30,
  hiring_engineer: 35,
  hiring_sales: 35,
  hiring_agency: 25,
  funding: 25,
  funding_announcement: 28,
  acquisition: 30,
  launch: 20,
  product_launch: 22,
  pain: 25,
  advertising: 20,
  partnership: 15,
  tech_usage: 15,
  growth_activity: 10,
  expansion: 20,
  team_growth: 18,
  remote_hiring: 28,
  outbound_pain: 30,
  automation_need: 28,
}

/**
 * ===============================
 * Standardized Opportunity
 * ===============================
 */
export type EntityType = "company" | "person"

export interface Opportunity {
  entity_type: EntityType
  name: string
  domain?: string
  source: string
  signal: string
  sub_signal?: string
  confidence: number
  score?: number
  metadata?: Record<string, unknown>
}

/**
 * ===============================
 * Brand Intent
 * ===============================
 *
 * Defines what signals a brand cares about.
 */
export interface BrandIntent {
  id: string
  brand_id: string
  intent: string
  signals: SignalType[]
  priority: number
  is_active: boolean
  created_at: string
}

/**
 * ===============================
 * Qualification Status
 * ===============================
 */
export type QualificationStatus =
  | "new"
  | "qualified"
  | "contacted"
  | "replied"
  | "converted"
  | "disqualified"