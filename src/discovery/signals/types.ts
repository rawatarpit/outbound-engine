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
  // NEW: All brand types
  AGENCY_LOOKING_CLIENTS: "agency_looking_clients",
  AGENCY_LOOKING_SPONSORS: "agency_looking_sponsors",
  PRODUCT_GROWTH: "product_growth",
  PRODUCT_SPONSORS: "product_sponsors",
  EVENT_SPONSORS: "event_sponsors",
  EVENT_ATTENDEES: "event_attendees",
  INFLUENCER_COLLAB: "influencer_collab",
  PODCAST_SPONSORS: "podcast_sponsors",
  NEWSLETTER_SPONSORS: "newsletter_sponsors",
  STARTUP_GROWTH: "startup_growth",
  SAAS_SEARCH: "saas_search",
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
  // All brand types
  agency_looking_clients: 35,
  agency_looking_sponsors: 30,
  product_growth: 28,
  product_sponsors: 25,
  event_sponsors: 30,
  event_attendees: 25,
  influencer_collab: 25,
  podcast_sponsors: 28,
  newsletter_sponsors: 28,
  startup_growth: 30,
  saas_search: 30,
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