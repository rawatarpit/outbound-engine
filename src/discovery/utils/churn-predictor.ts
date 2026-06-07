import fs from "fs"
import path from "path"

const PREDICTOR_FILE = path.resolve(process.cwd(), "data", "churn-predictor.json")

interface LeadOutcome {
  domain: string
  signals: string[]
  sourceAdapters: string[]
  domainQuality: number
  signalStrength: number
  extractionConfidence: number
  hadContact: boolean
  converted: boolean
  timestamp: number
}

interface PredictorStore {
  outcomes: LeadOutcome[]
}

function load(): PredictorStore {
  try {
    if (fs.existsSync(PREDICTOR_FILE)) {
      return JSON.parse(fs.readFileSync(PREDICTOR_FILE, "utf-8"))
    }
  } catch { /* ignore */ }
  return { outcomes: [] }
}

function save(store: PredictorStore): void {
  const dir = path.dirname(PREDICTOR_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(PREDICTOR_FILE, JSON.stringify(store, null, 2))
}

export function recordLeadOutcome(outcome: LeadOutcome): void {
  const store = load()
  store.outcomes.push(outcome)
  save(store)
}

export function predictChurnRisk(params: {
  signals: string[]
  domainQuality: number
  signalStrength: number
  extractionConfidence: number
  hadContact: boolean
}): { riskScore: number; riskLevel: "low" | "medium" | "high"; reasons: string[] } {
  const store = load()
  const reasons: string[] = []
  let riskScore = 0

  const recentOutcomes = store.outcomes.slice(-100)
  if (recentOutcomes.length < 10) {
    return { riskScore: 0.3, riskLevel: "medium", reasons: ["Insufficient historical data — defaulting to medium risk"] }
  }

  const signalChurnRates: Record<string, { total: number; churned: number }> = {}
  for (const o of recentOutcomes) {
    for (const s of o.signals) {
      if (!signalChurnRates[s]) signalChurnRates[s] = { total: 0, churned: 0 }
      signalChurnRates[s].total++
      if (!o.converted) signalChurnRates[s].churned++
    }
  }

  for (const signal of params.signals) {
    const sr = signalChurnRates[signal]
    if (sr && sr.total >= 3) {
      const churnRate = sr.churned / sr.total
      if (churnRate > 0.6) {
        riskScore += 0.25
        reasons.push(`Signal "${signal}" has ${Math.round(churnRate * 100)}% historical churn rate`)
      } else if (churnRate < 0.3) {
        riskScore -= 0.15
        reasons.push(`Signal "${signal}" has only ${Math.round(churnRate * 100)}% churn rate — favorable`)
      }
    }
  }

  if (params.extractionConfidence < 0.3) {
    riskScore += 0.2
    reasons.push("Low extraction confidence (< 0.3)")
  }
  if (params.domainQuality < 0.3) {
    riskScore += 0.15
    reasons.push("Low domain quality (< 0.3)")
  }
  if (!params.hadContact) {
    riskScore += 0.1
    reasons.push("No contact discovered")
  }

  riskScore = Math.max(0, Math.min(1, riskScore))

  let riskLevel: "low" | "medium" | "high"
  if (riskScore < 0.25) riskLevel = "low"
  else if (riskScore < 0.5) riskLevel = "medium"
  else riskLevel = "high"

  return { riskScore, riskLevel, reasons }
}

export function getChurnStats(): { totalTracked: number; converted: number; unconverted: number; conversionRate: number } {
  const store = load()
  const converted = store.outcomes.filter(o => o.converted).length
  const total = store.outcomes.length
  return {
    totalTracked: total,
    converted,
    unconverted: total - converted,
    conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
  }
}
