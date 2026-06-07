import pino from "pino"
import { Signal, SignalType } from "./signal-extractor"

const logger = pino({ level: "debug" })

export interface MultiDimensionalScore {
  painScore: number
  urgencyScore: number
  budgetScore: number
  technicalFitScore: number
  automationFitScore: number
  compositeScore: number
  confidenceLevel: "low" | "medium" | "high"
  breakdown: string[]
}

export const SCORE_WEIGHTS = {
  pain: 0.30,
  urgency: 0.25,
  budget: 0.20,
  technicalFit: 0.15,
  automationFit: 0.10,
}

export const THRESHOLDS = {
  contactDiscovery: 65,
  highPriority: 80,
}

/* =========================================================
   PAIN SCORE: Signal specificity, intensity, recurrence, impact
   ========================================================= */

const PAIN_INTENSITY_INDICATORS = [
  { pattern: /(critical|urgent|desperate|dire|crucial|vital|essential)/i, weight: 0.3 },
  { pattern: /(struggling|suffering|losing|bleeding|dying|failing|broken)/i, weight: 0.25 },
  { pattern: /(frustrated|fed\s+up|tired|annoyed|waste|wasting)/i, weight: 0.2 },
  { pattern: /(too\s+(slow|expensive|complex|manual|difficult)|not\s+(scaling|working|enough))/i, weight: 0.2 },
  { pattern: /(months|years)\s+(of|struggling|dealing|trying)/i, weight: 0.15 },
]

const PAIN_SPECIFICITY_INDICATORS = [
  { pattern: /(specifically|exactly|precisely)\s+(need|looking|want)/i, weight: 0.3 },
  { pattern: /\$\d+[kbm]?\b.*(?:loss|waste|cost|saving|spend)/i, weight: 0.35 },
  { pattern: /\d+%\s+(?:of|faster|more|better|worse|reduction)/i, weight: 0.25 },
  { pattern: /(current|existing|our)\s+(?:process|system|tool|stack|workflow|pipeline)/i, weight: 0.2 },
]

function calculatePainScore(signal: Signal): { score: number; reasons: string[] } {
  const text = signal.raw_text
  const reasons: string[] = []
  let intensity = 0

  for (const ind of PAIN_INTENSITY_INDICATORS) {
    if (ind.pattern.test(text)) {
      intensity += ind.weight
      reasons.push(`Pain intensity: matched '${ind.pattern.source.slice(0, 30)}'`)
    }
  }

  let specificity = 0
  for (const ind of PAIN_SPECIFICITY_INDICATORS) {
    if (ind.pattern.test(text)) {
      specificity += ind.weight
      reasons.push(`Pain specificity: matched '${ind.pattern.source.slice(0, 30)}'`)
    }
  }

  // Base score from signal type
  let baseScore = 0
  switch (signal.signal_type) {
    case SignalType.SERVICE_SEEKER_PAIN:
    case SignalType.PAIN_POINT:
      baseScore = 60
      reasons.push(`Base: ${signal.signal_type}`)
      break
    case SignalType.BURNOUT:
      baseScore = 50
      break
    case SignalType.TOOL_SEARCH:
      baseScore = 40
      break
    default:
      baseScore = 20
  }

  const combined = Math.min(baseScore + (intensity * 40) + (specificity * 40), 100)
  return { score: combined, reasons }
}

/* =========================================================
   URGENCY SCORE: Time-bound language, competitive pressure, deadlines
   ========================================================= */

const URGENCY_INDICATORS = [
  { pattern: /\b(immediately|urgent|urgently|asap|right\s+away|right\s+now)\b/i, weight: 0.35 },
  { pattern: /(this|next|current)\s+(quarter|month|week|year)\b/i, weight: 0.25 },
  { pattern: /\b(q[1-4])\s*\d{4}/i, weight: 0.2 },
  { pattern: /(deadline|due\s+date|timeline|target\s+date)/i, weight: 0.3 },
  { pattern: /\d{4}-\d{2}-\d{2}/, weight: 0.15 },
  { pattern: /(by|before|until)\s+(next|this|end\s+of)/i, weight: 0.2 },
  { pattern: /(already|currently|now)\s+(looking|evaluating|shopping|searching)/i, weight: 0.25 },
  { pattern: /(losing|missing|falling\s+behind|can'?t\s+wait)\s+/i, weight: 0.3 },
  { pattern: /(competitive|competition|competitor|market\s+pressure)/i, weight: 0.2 },
  { pattern: /(regulatory|compliance|audit|deadline)\s+/i, weight: 0.25 },
]

function calculateUrgencyScore(signal: Signal): { score: number; reasons: string[] } {
  const text = signal.raw_text
  const reasons: string[] = []
  let urgency = 0

  for (const ind of URGENCY_INDICATORS) {
    if (ind.pattern.test(text)) {
      urgency += ind.weight
      reasons.push(`Urgency: matched '${ind.pattern.source.slice(0, 30)}'`)
    }
  }

  // Boost if signal type is inherently urgent
  let typeBoost = 0
  switch (signal.signal_type) {
    case SignalType.HIRING:
      typeBoost = 20
      reasons.push("Type boost: HIRING")
      break
    case SignalType.BURNOUT:
      typeBoost = 25
      reasons.push("Type boost: BURNOUT")
      break
    case SignalType.BUDGET_ALLOCATION:
      typeBoost = 30
      reasons.push("Type boost: BUDGET_ALLOCATION")
      break
    case SignalType.TOOL_SEARCH:
      typeBoost = 15
      break
  }

  const combined = Math.min(typeBoost + (urgency * 100), 100)
  return { score: combined, reasons }
}

/* =========================================================
   BUDGET SCORE: Funding, hiring patterns, capex, company size
   ========================================================= */

const BUDGET_INDICATORS = [
  { pattern: /\b(raised|funding|investment|series\s+[a-z]|seed|round)\b/i, weight: 0.35 },
  { pattern: /\$\d+[kbm]?\b/i, weight: 0.25 },
  { pattern: /(budget|allocated|approved|earmarked)\s+(for|to)/i, weight: 0.35 },
  { pattern: /(capex|opex|technology\s+spend|it\s+budget)/i, weight: 0.3 },
  { pattern: /(hiring|growing|expanding|scaling)\s+(team|rapidly|aggressively)/i, weight: 0.2 },
  { pattern: /(funded|profitable|revenue|growth)\s+/i, weight: 0.15 },
]

function calculateBudgetScore(signal: Signal, context?: { signal_type: SignalType }): { score: number; reasons: string[] } {
  const text = signal.raw_text
  const reasons: string[] = []
  let budget = 0

  for (const ind of BUDGET_INDICATORS) {
    if (ind.pattern.test(text)) {
      budget += ind.weight
      reasons.push(`Budget: matched '${ind.pattern.source.slice(0, 30)}'`)
    }
  }

  let typeBoost = 0
  if (signal.signal_type === SignalType.BUDGET_ALLOCATION) {
    typeBoost = 35
    reasons.push("Type boost: BUDGET_ALLOCATION")
  } else if (signal.signal_type === SignalType.FUNDING) {
    typeBoost = 30
    reasons.push("Type boost: FUNDING")
  } else if (signal.signal_type === SignalType.HIRING) {
    typeBoost = 15
    reasons.push("Type boost: HIRING (implies budget)")
  }

  const combined = Math.min(typeBoost + (budget * 100), 100)
  return { score: combined, reasons }
}

/* =========================================================
   TECHNICAL FIT: Current tech stack, integration complexity
   ========================================================= */

const TECH_FIT_INDICATORS = [
  { pattern: /(tech\s+stack|technology\s+stack|stack)/i, weight: 0.2 },
  { pattern: /(legacy|outdated|old\s+system|aging)/i, weight: 0.3 },
  { pattern: /(integration|api|connect|sync|import|export)/i, weight: 0.2 },
  { pattern: /(modernize|upgrade|migrate|migration|replatform)/i, weight: 0.25 },
  { pattern: /(automation|automated|workflow|pipeline)/i, weight: 0.2 },
  { pattern: /(salesforce|hubspot|crm|marketing\s+automation|outbound|email)/i, weight: 0.2 },
]

function calculateTechnicalFitScore(signal: Signal): { score: number; reasons: string[] } {
  const text = signal.raw_text
  const reasons: string[] = []
  let fit = 0

  for (const ind of TECH_FIT_INDICATORS) {
    if (ind.pattern.test(text)) {
      fit += ind.weight
      reasons.push(`Tech fit: matched '${ind.pattern.source.slice(0, 30)}'`)
    }
  }

  let typeBoost = 0
  if (signal.signal_type === SignalType.TECH_MODERNIZATION) {
    typeBoost = 30
    reasons.push("Type boost: TECH_MODERNIZATION")
  } else if (signal.signal_type === SignalType.MIGRATION) {
    typeBoost = 25
    reasons.push("Type boost: MIGRATION")
  }

  const combined = Math.min(typeBoost + (fit * 100), 100)
  return { score: combined, reasons }
}

/* =========================================================
   AUTOMATION FIT: Repetitive process, manual workflow, scalability
   ========================================================= */

const AUTOMATION_INDICATORS = [
  { pattern: /(manual|tedious|repetitive|time-consuming|labor-intensive)/i, weight: 0.3 },
  { pattern: /(automation|automated|workflow|pipeline|orchestrat)/i, weight: 0.25 },
  { pattern: /(scal|grow|expand|ramp\s+up)\s.*(problem|issue|challenge|pain)/i, weight: 0.25 },
  { pattern: /(too\s+many|too\s+much|overwhelmed|can'?t\s+keep\s+up)/i, weight: 0.25 },
  { pattern: /(efficiency|productivity|optimize|streamline|simplify)/i, weight: 0.2 },
  { pattern: /(process|workflow|operation)\s+(improve|better|fix|solve|help)/i, weight: 0.2 },
]

function calculateAutomationFitScore(signal: Signal): { score: number; reasons: string[] } {
  const text = signal.raw_text
  const reasons: string[] = []
  let fit = 0

  for (const ind of AUTOMATION_INDICATORS) {
    if (ind.pattern.test(text)) {
      fit += ind.weight
      reasons.push(`Auto fit: matched '${ind.pattern.source.slice(0, 30)}'`)
    }
  }

  let typeBoost = 0
  if (signal.signal_type === SignalType.GROWTH_PRESSURE) {
    typeBoost = 25
    reasons.push("Type boost: GROWTH_PRESSURE")
  } else if (signal.signal_type === SignalType.BURNOUT) {
    typeBoost = 30
    reasons.push("Type boost: BURNOUT")
  }

  const combined = Math.min(typeBoost + (fit * 100), 100)
  return { score: combined, reasons }
}

/* =========================================================
   COMPOSITE SCORING
   ========================================================= */

export function calculateMultiDimensionalScore(
  signal: Signal,
  context?: { signal_type: SignalType }
): MultiDimensionalScore {
  const pain = calculatePainScore(signal)
  const urgency = calculateUrgencyScore(signal)
  const budget = calculateBudgetScore(signal)
  const techFit = calculateTechnicalFitScore(signal)
  const autoFit = calculateAutomationFitScore(signal)

  const composite = Math.round(
    (pain.score * SCORE_WEIGHTS.pain) +
    (urgency.score * SCORE_WEIGHTS.urgency) +
    (budget.score * SCORE_WEIGHTS.budget) +
    (techFit.score * SCORE_WEIGHTS.technicalFit) +
    (autoFit.score * SCORE_WEIGHTS.automationFit)
  )

  let confidenceLevel: "low" | "medium" | "high"
  if (composite >= THRESHOLDS.highPriority) {
    confidenceLevel = "high"
  } else if (composite >= THRESHOLDS.contactDiscovery) {
    confidenceLevel = "medium"
  } else {
    confidenceLevel = "low"
  }

  const breakdown = [
    ...pain.reasons,
    ...urgency.reasons,
    ...budget.reasons,
    ...techFit.reasons,
    ...autoFit.reasons,
  ]

  return {
    painScore: pain.score,
    urgencyScore: urgency.score,
    budgetScore: budget.score,
    technicalFitScore: techFit.score,
    automationFitScore: autoFit.score,
    compositeScore: composite,
    confidenceLevel,
    breakdown,
  }
}

export function shouldInitiateContactDiscovery(score: MultiDimensionalScore): boolean {
  return score.compositeScore >= THRESHOLDS.contactDiscovery
}

export function shouldPrioritizeOutbound(score: MultiDimensionalScore): boolean {
  return score.compositeScore >= THRESHOLDS.highPriority
}
