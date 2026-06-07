import pino from "pino"

const logger = pino({ level: "debug" })

export enum SignalType {
  HIRING = "HIRING",
  FUNDING = "FUNDING",
  LAUNCH = "LAUNCH",
  PAIN_POINT = "PAIN_POINT",
  TOOL_SEARCH = "TOOL_SEARCH",
  PARTNERSHIP = "PARTNERSHIP",
  EXPANSION = "EXPANSION",
  MIGRATION = "MIGRATION",
  COMPLIANCE = "COMPLIANCE",
  BURNOUT = "BURNOUT",
  // New signal types for better intent classification
  SERVICE_SEEKER_PAIN = "SERVICE_SEEKER_PAIN",
  GROWTH_PRESSURE = "GROWTH_PRESSURE",
  TECH_MODERNIZATION = "TECH_MODERNIZATION",
  BUDGET_ALLOCATION = "BUDGET_ALLOCATION",
  VENDOR_EVALUATION = "VENDOR_EVALUATION"
}

export interface Signal {
  signal_type: SignalType
  keywords: string[]
  confidence_score: number
  raw_text: string
  // New field to indicate intent (seeker vs provider)
  intent: 'seeker' | 'provider' | 'neutral'
  // New field for context analysis
  context_indicators: string[]
}

// Original keyword constants (restored from backup)
const HIRING_KEYWORDS = [
  "hiring", "we're hiring", "we are hiring", "join our team", "job opening",
  "looking for", "recruiting", "position available", "now hiring", "apply now",
  "sales manager", "account executive", "sales rep", "business development",
  "marketing manager", "growth lead", "head of sales", "sales director",
  "open roles", "career opportunity", "team growth", "expanding team",
  "senior engineer", "backend developer", "frontend developer", "full stack",
  "cto", "vp of", "chief", "director of", "lead engineer", "senior role",
  "remote first", "hiring remotely", "we're growing", "growing team",
  "sales team", "marketing hire", "technical hire", "new position",
]

const FUNDING_KEYWORDS = [
  "raised", "funding", "seed round", "series a", "series b", "series c",
  "investment", "valuation", "venture capital", "angel investor", "funding round",
  "million", "billion", "investment round", "closed round", "securing",
  "secured funding", "new investment", "capital raise", "pre-series",
  "bridge round", "extension", "追加融资", "估值",
]

const LAUNCH_KEYWORDS = [
  "launching", "launched", "just launched", "we're live", "we are live",
  "product hunt", "new product", "release", "live on", "available now",
  "introducing", "announcing", "built with", "built a", "created a",
  "shipping", "shipped", "first version", "released", "debut",
  "public launch", "coming soon", "now available", "general availability",
]

const PAIN_KEYWORDS = [
  "struggling", "problem", "pain point", "frustrated", "difficult",
  "challenge", "issue", "can't find", "looking for a solution",
  "any recommendations", "alternatives to", "better than",
  "switching from", "replacing", "need help", "stuck on", "not happy with",
  "waste of time", "slow", "expensive", "too complicated", "overwhelming",
  "not scaling", "breaking", "falls apart", "too manual", "tedious",
  "missing features", "what's the best", "recommend me", "thoughts on",
  "anyone tried", "has anyone used", "worth it", "regret", "disappointed",
]

const TOOL_SEARCH_KEYWORDS = [
  "what tool", "best tool", "recommend", "suggestions for",
  "looking for a tool", "which software", "what do you use for",
  "tool for", "software for", "platform for", "service for",
  "need a", "want a better", "tired of", "migrate to", "moving from",
  "switch to", "替代", "工具", "方案",
]

const PARTNERSHIP_KEYWORDS = [
  "partnership", "partner with", "looking for partners", "collaborate",
  "integration partner", "strategic partner", "channel partner",
  "reseller", "integration with", "co-marketing", "joint offering",
  "white label", "referral partner", "partner program", "partners wanted",
]

const EXPANSION_KEYWORDS = [
  "expanding", "expansion", "new market", "going global", "opening office",
  "scaling", "new location", "international", "enter new market",
  "moving to", "new city", "new region", "hiring in", "opening in",
  "entering", "global expansion", "apac", "emea", "latam", "saas expansion",
]

const MIGRATION_KEYWORDS = [
  "migrating from", "migrating to", "migration", "moving from", "switching to",
  "replace our", "replacing", "moving away from", "leaving", "porting",
  "upgrade from", "upgrading to", "legacy system", "modernizing", "replatform",
  "cloud migration", "digital transformation", "moving to the cloud",
]

const COMPLIANCE_KEYWORDS = [
  "compliance", "regulatory", "audit", "gdpr", "hipaa", "sox", "pci",
  "data privacy", "security compliance", "regulatory requirement",
  "compliance team", "compliance officer", "regulatory compliance",
  "need to be compliant", "compliance tool", "compliance automation",
]

const BURNOUT_KEYWORDS = [
  "burnout", "overworked", "understaffed", "too much work", "hiring freeze",
  "can't keep up", "falling behind", "overwhelmed", "team is stretched",
  "too few engineers", "lack of resources", "capacity issue",
  "overloaded", "not enough developers", "staffing shortage", "talent gap",
]

// Provider indicators - language used by service providers
const PROVIDER_INDICATORS = [
  "we offer", "we provide", "we build", "we create", "we develop",
  "our services", "our solutions", "our products", "we specialize",
  "we help companies", "we work with", "our team of experts",
  "years of experience", "proven track record", "trusted by",
  "award winning", "leading provider", "top rated", "best in class"
]

// Seeker indicators - language used by companies seeking services
const SEEKER_INDICATORS = [
  "we're struggling", "we are struggling", "struggling with",
  "need help", "need a solution", "looking for", "searching for",
  "trying to find", "can't find", "having trouble with",
  "frustrated with", "tired of", "fed up with", "not happy with",
  "disappointed with", "looking to replace", "considering alternatives",
  "evaluating options", "shopping around", "getting quotes",
  "budget approved", "funding allocated", "approved budget",
  "scaling operations", "can't keep up", "growing too fast",
  "legacy system", "outdated technology", "need to modernize",
  "replacing", "migrating from", "switching from",
  "pain point", "bottleneck", "inefficient process"
]

// Context windows (50-100 char) around keyword matches for disambiguation
const CONTEXT_WINDOW_SIZE = 80

// Negation patterns that indicate false positive signals
const NEGATION_PATTERNS = [
  { pattern: /not\s+(looking\s+for|searching\s+for|interested\s+in|hiring|seeking)/i, weight: -0.9 },
  { pattern: /(already\s+have|already\s+use|already\s+using|already\s+solved)/i, weight: -0.8 },
  { pattern: /satisfied\s+with|happy\s+with|content\s+with|pleased\s+with/i, weight: -0.7 },
  { pattern: /don\'?t\s+need|do\s+not\s+need|won\'?t\s+need|no\s+longer\s+need/i, weight: -0.85 },
  { pattern: /(fixed|solved|resolved)\s+(the\s+)?(issue|problem|pain\s+point)/i, weight: -0.75 },
  { pattern: /not\s+(struggling|having\s+issues|experiencing\s+problems)/i, weight: -0.8 },
  { pattern: /(avoid|steer\s+clear|stay\s+away|not\s+recommend)/i, weight: -0.6 },
]

// Provider pattern database - comprehensive patterns for service provider language
const PROVIDER_PATTERNS: { pattern: RegExp; weight: number; category: string }[] = [
  // Service offering patterns
  { pattern: /we\s+(offer|provide|deliver|build|create|develop|design)\s+/i, weight: 0.9, category: "service_offering" },
  { pattern: /our\s+(services|solutions|products|offerings|portfolio)/i, weight: 0.85, category: "service_offering" },
  { pattern: /(years\s+of\s+experience|proven\s+track\s+record|trusted\s+by)/i, weight: 0.85, category: "credibility" },
  { pattern: /(award\s+winning|leading\s+provider|top\s+rated|best\s+in\s+class|industry\s+leader)/i, weight: 0.75, category: "credibility" },
  { pattern: /(contact\s+us|get\s+in\s+touch|schedule\s+demo|request\s+quote|book\s+a\s+call)/i, weight: 0.8, category: "cta" },
  { pattern: /we\s+(specialize|excel|focus)\s+(in|on)\s+/i, weight: 0.85, category: "specialization" },
  { pattern: /(our\s+team\s+of|team\s+of\s+(experts|specialists|professionals|engineers))/i, weight: 0.8, category: "team" },
  { pattern: /(serving|helping)\s+(clients|customers|businesses|companies)\s+/i, weight: 0.8, category: "client_facing" },
  { pattern: /(end-to-end|full\s+cycle|complete|comprehensive)\s+(services|solutions)/i, weight: 0.75, category: "service_offering" },
  { pattern: /(consulting|consultancy|agency|studio|firm)\s+(services|partners|solutions)?/i, weight: 0.7, category: "entity_type" },
  { pattern: /we\s+work\s+with\s+(clients|customers|companies|brands)\s+to/i, weight: 0.85, category: "client_facing" },
  { pattern: /(let\s+us|we\s+can\s+help\s+you)\s+/i, weight: 0.7, category: "cta" },
  { pattern: /(case\s+studies?|testimonials?|portfolio|our\s+work)/i, weight: 0.75, category: "social_proof" },
  { pattern: /(digital\s+transformation|technology\s+partner|innovation\s+partner)/i, weight: 0.65, category: "positioning" },
  { pattern: /(fixed\s+price|hourly\s+rate|project\s+based|retainer)/i, weight: 0.8, category: "pricing" },
]

// Context patterns that strongly indicate seeker intent
const SEEKER_CONTEXTS = [
  { pattern: /(we|our|i|my).*?(need|looking for|searching for|struggling with|frustrated with)/i, weight: 0.9 },
  { pattern: /(need|looking for|searching for|want|require).*?(solution|tool|software|service|help|support)/i, weight: 0.85 },
  { pattern: /(struggling|frustrated|tired|fed up).*?(with|by).*?(process|system|software|tool)/i, weight: 0.8 },
  { pattern: /(evaluating|considering|reviewing|assessing).*?(alternatives|options|solutions|providers|vendors)/i, weight: 0.75 },
  { pattern: /(replacing|migrating|switching|moving away from).*?(legacy|old|outdated|current)/i, weight: 0.8 },
  { pattern: /(budget|funding|approved|allocated).*?(for|to).*?(project|initiative|solution|upgrade)/i, weight: 0.7 }
]

// Context patterns that strongly indicate provider intent
const PROVIDER_CONTEXTS = [
  { pattern: /(we|our).*?(offer|provide|build|create|develop|specialize in)/i, weight: 0.9 },
  { pattern: /(our|the).*?(team|experts|specialists|developers|engineers).*?(has|have|is|are)/i, weight: 0.8 },
  { pattern: /(years of experience|proven track record|trusted by|serving.*clients)/i, weight: 0.85 },
  { pattern: /(award winning|leading provider|top rated|best in class|industry leader)/i, weight: 0.75 },
  { pattern: /(contact us|get in touch|learn more|schedule demo|request quote)/i, weight: 0.7 }
]

// Enhanced keyword sets for new signal types
const SERVICE_SEEKER_PAIN_KEYWORDS = [
  "struggling", "problem", "pain point", "frustrated", "difficult",
  "challenge", "issue", "can't find", "looking for a solution",
  "any recommendations", "alternatives to", "better than",
  "switching from", "replacing", "need help", "stuck on", "not happy with",
  "waste of time", "slow", "expensive", "too complicated", "overwhelming",
  "not scaling", "breaking", "falls apart", "too manual", "tedious",
  "missing features", "what's the best", "recommend me", "thoughts on",
  "anyone tried", "has anyone used", "worth it", "regret", "disappointed"
]

const GROWTH_PRESSURE_KEYWORDS = [
  "scaling", "scale", "growing", "growth", "expanding", "expansion",
  "can't keep up", "overwhelmed", "too much", "too many", "increasing demand",
  "hiring surge", "need more", "short staffed", "understaffed",
  "capacity constraints", "bottleneck", "limiting growth",
  "scaling challenges", "growth pains", "scaling issues"
]

const TECH_MODERNIZATION_KEYWORDS = [
  "legacy", "outdated", "obsolete", "aging", "old system",
  "technical debt", "modernize", "upgrade", "migrate", "migration",
  "replatform", "replacing", "moving from", "switching from",
  "maintenance nightmare", "patchwork", "band-aid solution",
  "need to update", "time to upgrade", "technology refresh",
  "digital transformation", "tech stack update"
]

const BUDGET_ALLOCATION_KEYWORDS = [
  "budget approved", "funding allocated", "capital allocated",
  "investment approved", "budget for", "funding for",
  "approved budget", "allocated funds", "earmarked",
  "q1 budget", "q2 budget", "q3 budget", "q4 budget",
  "fy budget", "annual budget", "project budget",
  "capex", "opex", "technology spend", "it budget"
]

const VENDOR_EVALUATION_KEYWORDS = [
  "evaluating", "considering", "reviewing", "assessing",
  "looking at", "checking out", "researching", "comparing",
  "vendors", "providers", "suppliers", "solutions",
  "options", "alternatives", "choices", "candidates",
  "rfp", "request for proposal", "rfq", "request for quote",
  "demo", "trial", "pilot", "proof of concept",
  "getting quotes", "price comparison", "cost analysis"
]

// Enhanced priority weights including new signal types
const SIGNAL_PRIORITY: Record<SignalType, number> = {
  [SignalType.HIRING]: 1.2,
  [SignalType.PAIN_POINT]: 1.1,
  [SignalType.TOOL_SEARCH]: 1.3,
  [SignalType.FUNDING]: 1.0,
  [SignalType.LAUNCH]: 0.9,
  [SignalType.PARTNERSHIP]: 0.85,
  [SignalType.EXPANSION]: 0.8,
  [SignalType.MIGRATION]: 0.9,
  [SignalType.COMPLIANCE]: 0.95,
  [SignalType.BURNOUT]: 1.15,
  // Higher weights for seeker-focused signals
  [SignalType.SERVICE_SEEKER_PAIN]: 1.4,
  [SignalType.GROWTH_PRESSURE]: 1.3,
  [SignalType.TECH_MODERNIZATION]: 1.25,
  [SignalType.BUDGET_ALLOCATION]: 1.2,
  [SignalType.VENDOR_EVALUATION]: 1.35
}

// Extract context window around a keyword match position
function extractContextWindow(fullText: string, keyword: string): string {
  const idx = fullText.indexOf(keyword.toLowerCase())
  if (idx === -1) return ""
  const start = Math.max(0, idx - CONTEXT_WINDOW_SIZE)
  const end = Math.min(fullText.length, idx + keyword.length + CONTEXT_WINDOW_SIZE)
  return fullText.slice(start, end)
}

// Check if a keyword match context contains negation
function hasNegationInContext(contextWindow: string): boolean {
  const lower = contextWindow.toLowerCase()
  for (const neg of NEGATION_PATTERNS) {
    if (neg.pattern.test(lower)) {
      return true
    }
  }
  return false
}

// Evaluate provider pattern density in text
function evaluateProviderPatterns(text: string): { score: number; matchedPatterns: string[] } {
  const lower = text.toLowerCase()
  let score = 0
  const matchedPatterns: string[] = []
  for (const pp of PROVIDER_PATTERNS) {
    if (pp.pattern.test(lower)) {
      score += pp.weight
      matchedPatterns.push(pp.category)
    }
  }
  return {
    score: Math.min(score, 1.0),
    matchedPatterns: [...new Set(matchedPatterns)],
  }
}

export function extractSignal(text: string, title: string = ""): Signal {
  const fullText = `${title} ${text}`.toLowerCase()
  const originalFullText = `${title} ${text}`

  // Negation handling - check if entire text contains negation patterns
  const negationScore = calculateNegationScore(fullText)
  const hasStrongNegation = Math.abs(negationScore) > 0.5

  // Check for provider vs seeker intent indicators
  const providerScore = calculateIndicatorScore(fullText, PROVIDER_INDICATORS)
  const seekerScore = calculateIndicatorScore(fullText, SEEKER_INDICATORS)
  
  // Provider pattern database evaluation
  const providerPatternResult = evaluateProviderPatterns(fullText)
  
  // Determine intent based on indicator scores
  let intent: 'seeker' | 'provider' | 'neutral' = 'neutral'
  if (seekerScore > providerScore && seekerScore > 0.2) {
    intent = 'seeker'
  } else if (providerScore > seekerScore && providerScore > 0.2) {
    intent = 'provider'
  }
  
  // Override to provider if provider pattern density is high
  if (providerPatternResult.score > 0.6) {
    intent = 'provider'
  }
  
  // Check context patterns for stronger signals
  const seekerContextScore = calculateContextScore(fullText, SEEKER_CONTEXTS)
  const providerContextScore = calculateContextScore(fullText, PROVIDER_CONTEXTS)
  
  // Adjust intent based on context (context is stronger signal)
  if (seekerContextScore > 0.5) {
    intent = 'seeker'
  } else if (providerContextScore > 0.5) {
    intent = 'provider'
  }
  
  // Collect context indicators for transparency
  const contextIndicators: string[] = []
  SEEKER_CONTEXTS.forEach(ctx => {
    if (ctx.pattern.test(fullText)) {
      contextIndicators.push(`seeker:${ctx.pattern.source}`)
    }
  })
  PROVIDER_CONTEXTS.forEach(ctx => {
    if (ctx.pattern.test(fullText)) {
      contextIndicators.push(`provider:${ctx.pattern.source}`)
    }
  })
  if (providerPatternResult.matchedPatterns.length > 0) {
    contextIndicators.push(`provider_patterns:${providerPatternResult.matchedPatterns.join(",")}`)
  }
  if (negationScore < -0.3) {
    contextIndicators.push(`negation_detected:${negationScore}`)
  }

  // Enhanced signal detection with intent awareness and negation handling
  const signals: { type: SignalType; score: number; keywords: string[] }[] = []

  // Helper to check keywords with context window and negation
  function checkKeywordsWithContext(
    text: string,
    type: SignalType,
    keywords: string[]
  ): { type: SignalType; score: number; keywords: string[] } {
    const found: string[] = []
    let score = 0

    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        const context = extractContextWindow(originalFullText, keyword)
        if (hasNegationInContext(context)) {
          continue
        }
        found.push(keyword)
        score += 1
      }
    }

    return { type, score, keywords: found }
  }

  // Original signals (enhanced with intent weighting and negation handling)
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.HIRING, HIRING_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.FUNDING, FUNDING_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.LAUNCH, LAUNCH_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.PAIN_POINT, PAIN_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.TOOL_SEARCH, TOOL_SEARCH_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.PARTNERSHIP, PARTNERSHIP_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.EXPANSION, EXPANSION_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.MIGRATION, MIGRATION_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.COMPLIANCE, COMPLIANCE_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.BURNOUT, BURNOUT_KEYWORDS), intent))
  
  // New seeker-focused signals
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.SERVICE_SEEKER_PAIN, SERVICE_SEEKER_PAIN_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.GROWTH_PRESSURE, GROWTH_PRESSURE_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.TECH_MODERNIZATION, TECH_MODERNIZATION_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.BUDGET_ALLOCATION, BUDGET_ALLOCATION_KEYWORDS), intent))
  signals.push(enhanceSignalWithIntent(checkKeywordsWithContext(fullText, SignalType.VENDOR_EVALUATION, VENDOR_EVALUATION_KEYWORDS), intent))

  signals.sort((a, b) => b.score - a.score)

  const bestSignal = signals[0]

  // If no clear signal, default based on intent
  if (bestSignal.score === 0) {
    const defaultSignalType = intent === 'seeker' ? SignalType.SERVICE_SEEKER_PAIN : SignalType.PAIN_POINT
    return {
      signal_type: defaultSignalType,
      keywords: [],
      confidence_score: 0.2,
      raw_text: text,
      intent: intent,
      context_indicators: contextIndicators
    }
  }

  // Calculate confidence with intent bonus and negation penalty
  const priorityBonus = SIGNAL_PRIORITY[bestSignal.type] || 1.0
  let confidence = Math.min((bestSignal.score / 3) * priorityBonus, 1.0)
  
  // Boost confidence for clear seeker intent (our target)
  if (intent === 'seeker') {
    confidence = Math.min(confidence * 1.2, 1.0)
  } 
  // Reduce confidence for clear provider intent (not our target)
  else if (intent === 'provider') {
    confidence = confidence * 0.7
  }

  // Apply negation penalty if strong negation detected
  if (negationScore < -0.3) {
    confidence = confidence * (1 + negationScore)
  }

  return {
    signal_type: bestSignal.type,
    keywords: bestSignal.keywords,
    confidence_score: Math.max(0, confidence),
    raw_text: text,
    intent: intent,
    context_indicators: contextIndicators
  }
}

// Helper function to calculate indicator score (0-1)
function calculateIndicatorScore(text: string, indicators: string[]): number {
  let matches = 0
  for (const indicator of indicators) {
    if (text.includes(indicator.toLowerCase())) {
      matches++
    }
  }
  return Math.min(matches / 5, 1.0) // Normalize to 0-1 scale (5+ indicators = max score)
}

// Helper function to calculate negation score (negative = strong negation, positive = strong affirmation)
function calculateNegationScore(text: string): number {
  let score = 0
  for (const neg of NEGATION_PATTERNS) {
    if (neg.pattern.test(text)) {
      score += neg.weight
    }
  }
  return score
}

// Helper function to calculate context pattern score (0-1)
function calculateContextScore(text: string, contexts: {pattern: RegExp, weight: number}[]): number {
  let score = 0
  for (const ctx of contexts) {
    if (ctx.pattern.test(text)) {
      score += ctx.weight
    }
  }
  return Math.min(score, 1.0) // Normalize to 0-1 scale, cap at 1.0
}

// Helper function to check keywords (restored from original)
function checkKeywords(
  text: string,
  type: SignalType,
  keywords: string[]
): { type: SignalType; score: number; keywords: string[] } {
  const found: string[] = []
  let score = 0

  for (const keyword of keywords) {
    if (text.includes(keyword.toLowerCase())) {
      found.push(keyword)
      score += 1
    }
  }

  return { type, score, keywords: found }
}

// Helper function to enhance signal score based on intent
function enhanceSignalWithIntent(signalResult: { type: SignalType; score: number; keywords: string[] }, intent: 'seeker' | 'provider' | 'neutral'): { type: SignalType; score: number; keywords: string[] } {
  // Boost seeker-focused signals when intent is seeker
  if (intent === 'seeker' && 
      [SignalType.SERVICE_SEEKER_PAIN, SignalType.GROWTH_PRESSURE, SignalType.TECH_MODERNIZATION, 
       SignalType.BUDGET_ALLOCATION, SignalType.VENDOR_EVALUATION].includes(signalResult.type)) {
    return { ...signalResult, score: signalResult.score * 1.3 }
  }
  
  // Boost traditional signals when intent is neutral or provider (existing behavior)
  if (intent !== 'seeker' && 
      [SignalType.HIRING, SignalType.FUNDING, SignalType.LAUNCH, SignalType.PAIN_POINT, 
       SignalType.TOOL_SEARCH, SignalType.PARTNERSHIP, SignalType.EXPANSION, 
       SignalType.MIGRATION, SignalType.COMPLIANCE, SignalType.BURNOUT].includes(signalResult.type)) {
    return { ...signalResult, score: signalResult.score * (intent === 'provider' ? 1.1 : 1.0) }
  }
  
  // Reduce score for seeker signals when intent is provider (not our target)
  if (intent === 'provider' && 
      [SignalType.SERVICE_SEEKER_PAIN, SignalType.GROWTH_PRESSURE, SignalType.TECH_MODERNIZATION, 
       SignalType.BUDGET_ALLOCATION, SignalType.VENDOR_EVALUATION].includes(signalResult.type)) {
    return { ...signalResult, score: signalResult.score * 0.6 }
  }
  
  return signalResult
}

export function batchExtractSignals(items: { title?: string; text: string }[]): Signal[] {
  return items.map(item => extractSignal(item.text, item.title || ""))
}