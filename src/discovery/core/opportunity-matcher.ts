import pino from "pino"
import { Signal, SignalType } from "./signal-extractor"
import { calculateMultiDimensionalScore, MultiDimensionalScore, shouldInitiateContactDiscovery } from "./scoring"

const logger = pino({ level: "debug" })

export interface BrandContext {
  name: string
  industry?: string
  target_roles?: string[]
  target_signals?: string[]
  keywords?: string[]
}

export interface OpportunityScore {
  relevance_score: number
  urgency_score: number
  fit_reason: string
  multiDimensional?: MultiDimensionalScore
}

const HIRING_BOOST_ROLES = [
  "sales", "account executive", "business development", "marketing",
  "growth", "sales manager", "sales director", "head of sales"
]

const HIGH_INTENT_SIGNALS = [
  SignalType.HIRING,
  SignalType.TOOL_SEARCH,
  SignalType.PAIN_POINT
]

export function matchOpportunity(
  signal: Signal,
  brandContext: BrandContext
): OpportunityScore {
  let relevanceScore = 50
  let urgencyScore = 30
  const fitReasons: string[] = []

  // Multi-dimensional scoring (Phase 5)
  const multiScore = calculateMultiDimensionalScore(signal)

  if (HIGH_INTENT_SIGNALS.includes(signal.signal_type)) {
    relevanceScore += 20
    fitReasons.push(`High-intent signal: ${signal.signal_type}`)
  }

  if (signal.signal_type === SignalType.HIRING) {
    relevanceScore += 15
    urgencyScore += 25

    const matchedRoles = signal.keywords.filter(kw =>
      HIRING_BOOST_ROLES.some(role => kw.toLowerCase().includes(role))
    )

    if (matchedRoles.length > 0) {
      relevanceScore += 15
      fitReasons.push(`Hiring for target roles: ${matchedRoles.join(", ")}`)
    }
  }

  if (signal.signal_type === SignalType.TOOL_SEARCH) {
    relevanceScore += 20
    urgencyScore += 20
    fitReasons.push("Explicit tool search detected")
  }

  if (signal.signal_type === SignalType.PAIN_POINT) {
    relevanceScore += 15
    urgencyScore += 30
    fitReasons.push("Pain point indicates immediate need")
  }

  if (signal.signal_type === SignalType.LAUNCH) {
    relevanceScore += 10
    urgencyScore += 15
    fitReasons.push("New product launch - potential customer")
  }

  if (signal.signal_type === SignalType.FUNDING) {
    relevanceScore += 10
    urgencyScore += 10
    fitReasons.push("Recently funded - budget available")
  }

  if (brandContext.keywords) {
    const text = signal.raw_text.toLowerCase()
    const highIntentKeywords = brandContext.keywords.filter(kw => {
      const lower = kw.toLowerCase()
      const genericWords = ["ai", "and", "we", "run", "systems", "that", "with", "without", "manual", "effort", "the", "for", "our", "is", "in", "on", "at", "by", "or", "be", "an", "as", "will", "do", "not", "but", "if", "from", "has", "have", "had", "what", "when", "where", "who", "which", "how", "all", "any", "can", "etc", "get", "your"]
      if (genericWords.includes(lower)) return false
      return text.includes(lower)
    })

    if (highIntentKeywords.length > 0) {
      relevanceScore += highIntentKeywords.length * 5
      fitReasons.push(`Matched brand keywords: ${highIntentKeywords.join(", ")}`)
    }
  }

  if (signal.confidence_score > 0.7) {
    relevanceScore += 10
    urgencyScore += 5
  }

  relevanceScore = Math.min(relevanceScore, 100)
  urgencyScore = Math.min(urgencyScore, 100)

  if (relevanceScore < 70) {
    fitReasons.unshift("REJECTED: Relevance below threshold (70)")
  }

  return {
    relevance_score: relevanceScore,
    urgency_score: urgencyScore,
    fit_reason: fitReasons.join("; "),
    multiDimensional: multiScore,
  }
}

export function filterHighIntentOpportunities(
  opportunities: { signal: Signal; score: OpportunityScore }[]
): { signal: Signal; score: OpportunityScore }[] {
  const filtered = opportunities.filter(opp => opp.score.relevance_score >= 70)

  logger.info(
    {
      total: opportunities.length,
      highIntent: filtered.length
    },
    "Filtered high-intent opportunities"
  )

  return filtered
}
