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
} as const

export type SignalType = typeof SignalType[keyof typeof SignalType]

export const SIGNAL_WEIGHTS: Record<string, number> = {
  hiring: 30,
  funding: 25,
  launch: 20,
  pain: 25,
  advertising: 20,
  partnership: 15,
  tech_usage: 15,
  growth_activity: 10,
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