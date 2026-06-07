import pino from "pino"
import dns from "dns"
import { promisify } from "util"
import { Signal } from "./signal-extractor"
import { PreValidationResult } from "./pre-validation"

const logger = pino({ level: "info" })
const resolveMx = promisify(dns.resolveMx)

export interface ValidationDimension {
  name: string
  score: number
  confidence: number
  details: string[]
}

export interface ValidationResult {
  overallConfidence: number
  dimensions: ValidationDimension[]
  passed: boolean
  requiresManualReview: boolean
  fastTrack: boolean
}

export const VALIDATION_THRESHOLDS = {
  fastTrack: 0.90,
  autoAccept: 0.70,
  manualReview: 0.50,
}

/* =========================================================
   1. DOMAIN/IP GEOLOCATION CHECK
   ========================================================= */

const COUNTRY_TLDS: Record<string, string> = {
  ae: "UAE", uk: "UK", de: "Germany", fr: "France", nl: "Netherlands",
  es: "Spain", it: "Italy", se: "Sweden", no: "Norway", dk: "Denmark",
  fi: "Finland", be: "Belgium", at: "Austria", ch: "Switzerland",
  pl: "Poland", cz: "Czech", ie: "Ireland", us: "United States",
  ca: "Canada", au: "Australia", nz: "New Zealand", sg: "Singapore",
  jp: "Japan", in: "India", br: "Brazil", mx: "Mexico",
}

function checkDomainGeolocation(domain: string | undefined): ValidationDimension {
  const details: string[] = []
  let score = 0.5
  let confidence = 0.3

  if (domain) {
    const tld = domain.split(".").pop()?.toLowerCase()
    if (tld && COUNTRY_TLDS[tld]) {
      const country = COUNTRY_TLDS[tld]
      details.push(`Domain TLD .${tld} maps to ${country}`)
      score = 0.8
      confidence = 0.7
    } else if (tld && ["com", "org", "net", "io", "co", "app"].includes(tld)) {
      details.push(`Generic TLD .${tld} - no specific geo from domain`)
      score = 0.5
      confidence = 0.3
    } else {
      details.push(`Unknown TLD .${tld} - cannot determine geo from domain`)
      score = 0.3
      confidence = 0.2
    }

    if (domain.length > 3) {
      const namePart = domain.split(".")[0]
      const locationHints = ["dubai", "london", "berlin", "paris", "nyc", "sf", "tokyo"]
      if (locationHints.some(h => namePart.includes(h))) {
        details.push(`Domain name contains location hint: ${namePart}`)
        score = Math.min(score + 0.15, 1.0)
        confidence = Math.min(confidence + 0.15, 1.0)
      }
    }
  } else {
    details.push("No domain available for geolocation check")
    score = 0.3
    confidence = 0.1
  }

  return { name: "domain_geolocation", score, confidence, details }
}

/* =========================================================
   2. BUSINESS REGISTRATION SIGNALS
   ========================================================= */

const REGISTRATION_INDICATORS = [
  /\b(inc|incorporated|ltd|limited|llc|corp|corporation|plc|gmbh|ag|bv|nv|sarl|sa|spa)\b/i,
  /\b(registered\s+(in|at|with)|incorporated\s+in|founded\s+in|established\s+in)\b/i,
  /\b(company\s+(registration|number|no)|c\.?r\.?\.?\s*no|business\s+license)\b/i,
  /\b(duns|dun\s+&\s+bradstreet|legal\s+name|trading\s+as)\b/i,
]

function checkBusinessRegistration(signal: Signal): ValidationDimension {
  const details: string[] = []
  const indicators = REGISTRATION_INDICATORS.reduce((count, p) => {
    return p.test(signal.raw_text) ? count + 1 : count
  }, 0)

  const score = indicators > 0 ? 0.7 : 0.4
  const confidence = indicators > 0 ? 0.5 : 0.2

  if (indicators > 0) {
    details.push(`Found ${indicators} business registration indicator(s)`)
  } else {
    details.push("No business registration indicators found in signal")
  }

  return { name: "business_registration", score, confidence, details }
}

/* =========================================================
   3. EMPLOYEE COUNT VERIFICATION
   ========================================================= */

const EMPLOYEE_PATTERNS = [
  /(?:we\s+(?:are\s+)?|our\s+team\s+(?:of\s+)?)(\d+)\s*(?:people|person|employees?|staff|team\s+members?)/i,
  /(?:team\s+of\s+|staff\s+of\s+)(\d+)/i,
  /(\d+)\s*(?:people|person|employees?|staff)\s+(?:team|strong)/i,
  /(?:grown\s+to\s+|expanded\s+to\s+|now\s+at\s+)(\d+)\s*(?:people|person|employees?)/i,
  /(\d+)[\+]?\s*(?:-|to)?\s*(\d+)?\s*employees?/i,
]

function checkEmployeeCount(signal: Signal): ValidationDimension {
  const details: string[] = []
  let employeeCount: number | null = null

  for (const pattern of EMPLOYEE_PATTERNS) {
    const match = signal.raw_text.match(pattern)
    if (match) {
      const num = parseInt(match[1])
      if (!isNaN(num)) {
        employeeCount = num
        details.push(`Employee count from text: ~${num}`)
        break
      }
    }
  }

  let score = 0.5
  let confidence = 0.3

  if (employeeCount !== null) {
    if (employeeCount >= 5 && employeeCount <= 100) {
      score = 0.9
      confidence = 0.8
      details.push("Size within target range (5-100)")
    } else if (employeeCount < 5) {
      score = 0.2
      confidence = 0.7
      details.push(`Size too small: ${employeeCount}`)
    } else if (employeeCount > 1000) {
      score = 0.2
      confidence = 0.7
      details.push(`Size too large: ${employeeCount}`)
    } else {
      score = 0.6
      confidence = 0.6
      details.push(`Size acceptable: ${employeeCount}`)
    }
  } else {
    details.push("No employee count found in signal text")
  }

  return { name: "employee_count", score, confidence, details }
}

/* =========================================================
   4. INDUSTRY CLASSIFICATION CHECK
   ========================================================= */

const TARGET_INDUSTRIES = [
  "manufacturing", "healthcare", "finance", "insurance", "retail",
  "ecommerce", "logistics", "supply chain", "real estate", "education",
  "construction", "transportation", "hospitality", "food",
  "professional services", "legal", "accounting",
]

function checkIndustry(signal: Signal): ValidationDimension {
  const details: string[] = []
  const text = signal.raw_text.toLowerCase()
  const industryMatches = TARGET_INDUSTRIES.filter(ind => text.includes(ind))

  let score = 0.5
  let confidence = 0.3

  if (industryMatches.length > 0) {
    score = 0.85
    confidence = 0.7
    details.push(`Target industry matched: ${industryMatches.join(", ")}`)
  } else {
    details.push("No specific target industry found in signal")
    // Check if it's pure tech (which we want to avoid)
    if (/software|saas|app\s+developer|tech\s+company/.test(text)) {
      score = 0.3
      confidence = 0.5
      details.push("Likely pure tech/software - may not be target")
    }
  }

  return { name: "industry_classification", score, confidence, details }
}

/* =========================================================
   MAIN VALIDATION LOOP
   ========================================================= */

export function runValidationLoop(
  companyName: string,
  domain: string | undefined,
  signal: Signal,
  preValidation?: PreValidationResult
): ValidationResult {
  const dimensions: ValidationDimension[] = [
    checkDomainGeolocation(domain),
    checkBusinessRegistration(signal),
    checkEmployeeCount(signal),
    checkIndustry(signal),
  ]

  if (preValidation) {
    dimensions.push({
      name: "pre_validation",
      score: preValidation.signalQuality,
      confidence: preValidation.passed ? 0.8 : 0.2,
      details: preValidation.rejectionReasons.length > 0
        ? preValidation.rejectionReasons
        : ["Pre-validation passed"],
    })
  }

  const totalConfidence = dimensions.reduce((sum, d) => sum + d.confidence, 0)
  const weightedScore = dimensions.reduce((sum, d) => sum + (d.score * d.confidence), 0)
  const overallConfidence = totalConfidence > 0
    ? Math.round((weightedScore / totalConfidence) * 100) / 100
    : 0.5

  const allPassed = dimensions.every(d => d.score >= VALIDATION_THRESHOLDS.autoAccept)

  return {
    overallConfidence,
    dimensions,
    passed: overallConfidence >= VALIDATION_THRESHOLDS.autoAccept,
    requiresManualReview: overallConfidence < VALIDATION_THRESHOLDS.autoAccept && overallConfidence >= VALIDATION_THRESHOLDS.manualReview,
    fastTrack: overallConfidence >= VALIDATION_THRESHOLDS.fastTrack,
  }
}

/* =========================================================
   FEEDBACK LOOP - Track outcomes for threshold adjustment
   ========================================================= */

import fs from "fs"
import path from "path"

const FEEDBACK_LOOP_FILE = path.resolve(process.cwd(), "data", "validation-feedback-loop.json")

interface ValidationOutcome {
  companyName: string
  domain: string
  overallConfidence: number
  accepted: boolean
  converted: boolean
  timestamp: number
  dimensions: { name: string; score: number }[]
}

interface FeedbackLoopStore {
  outcomes: ValidationOutcome[]
  lastAdjustment: number
  dynamicThresholds: {
    contactDiscovery: number
    highPriority: number
    manualReview: number
  }
}

function loadFeedbackLoop(): FeedbackLoopStore {
  try {
    if (fs.existsSync(FEEDBACK_LOOP_FILE)) {
      return JSON.parse(fs.readFileSync(FEEDBACK_LOOP_FILE, "utf-8"))
    }
  } catch { }
  return {
    outcomes: [],
    lastAdjustment: Date.now(),
    dynamicThresholds: {
      contactDiscovery: 65,
      highPriority: 80,
      manualReview: 50,
    },
  }
}

function saveFeedbackLoop(store: FeedbackLoopStore): void {
  const dir = path.dirname(FEEDBACK_LOOP_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(FEEDBACK_LOOP_FILE, JSON.stringify(store, null, 2))
}

export function recordValidationOutcome(params: {
  companyName: string
  domain: string
  overallConfidence: number
  accepted: boolean
  converted: boolean
  dimensions: { name: string; score: number }[]
}): void {
  const store = loadFeedbackLoop()
  store.outcomes.push({
    ...params,
    timestamp: Date.now(),
  })
  saveFeedbackLoop(store)
}

export function adjustDynamicThresholds(): void {
  const store = loadFeedbackLoop()
  const recent = store.outcomes.slice(-100)

  if (recent.length < 20) {
    logger.info("Not enough data for threshold adjustment (<20 outcomes)")
    return
  }

  const accepted = recent.filter(o => o.accepted)
  const converted = accepted.filter(o => o.converted)
  const conversionRate = accepted.length > 0 ? converted.length / accepted.length : 0
  const falsePositiveRate = accepted.length > 0
    ? accepted.filter(o => !o.converted).length / accepted.length
    : 0

  // Adjust thresholds based on conversion rate
  if (conversionRate < 0.1) {
    store.dynamicThresholds.contactDiscovery = Math.min(store.dynamicThresholds.contactDiscovery + 5, 90)
    store.dynamicThresholds.highPriority = Math.min(store.dynamicThresholds.highPriority + 5, 95)
    logger.info({ conversionRate, newThreshold: store.dynamicThresholds.contactDiscovery }, "Raising thresholds due to low conversion")
  } else if (conversionRate > 0.3) {
    store.dynamicThresholds.contactDiscovery = Math.max(store.dynamicThresholds.contactDiscovery - 5, 40)
    store.dynamicThresholds.highPriority = Math.max(store.dynamicThresholds.highPriority - 5, 60)
    logger.info({ conversionRate, newThreshold: store.dynamicThresholds.contactDiscovery }, "Lowering thresholds due to high conversion")
  }

  if (falsePositiveRate > 0.7) {
    store.dynamicThresholds.manualReview = Math.min(store.dynamicThresholds.manualReview + 5, 70)
    logger.info({ falsePositiveRate, newThreshold: store.dynamicThresholds.manualReview }, "Raising manual review threshold")
  }

  store.lastAdjustment = Date.now()
  saveFeedbackLoop(store)
}

export function getFeedbackLoopReport(): string {
  const store = loadFeedbackLoop()
  const recent = store.outcomes.slice(-50)
  const accepted = recent.filter(o => o.accepted)
  const converted = accepted.filter(o => o.converted)

  return [
    `Validation Feedback Loop Report:`,
    `  Total tracked: ${store.outcomes.length}`,
    `  Recent (50): accepted=${accepted.length}, converted=${converted.length}`,
    `  Conversion rate: ${accepted.length > 0 ? (converted.length / accepted.length * 100).toFixed(0) : 0}%`,
    `  Dynamic thresholds: contactDiscovery=${store.dynamicThresholds.contactDiscovery}, highPriority=${store.dynamicThresholds.highPriority}, manualReview=${store.dynamicThresholds.manualReview}`,
    `  Last adjustment: ${new Date(store.lastAdjustment).toISOString()}`,
  ].join("\n")
}
