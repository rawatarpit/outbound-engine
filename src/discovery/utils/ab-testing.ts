import pino from "pino"
import { getLogger, createCorrelationContext, startTrace, endTrace, incrementMetric } from "./tracing"

const logger = pino({ level: "info" })

/* =========================================================
   A/B TESTING FRAMEWORK FOR DISCOVERY PIPELINE
   Allows comparing configurations of the pipeline
   ========================================================= */

export interface ABTestConfig {
  name: string
  description: string
  startDate: string
  variants: ABVariant[]
  trafficSplit: number
  minimumSampleSize: number
}

export interface ABVariant {
  id: string
  name: string
  config: Record<string, any>
}

export interface ABTestResult {
  testName: string
  variantId: string
  variantName: string
  impressions: number
  conversions: number
  conversionRate: number
  avgConfidence: number
  avgScore: number
}

const experiments: Map<string, { config: ABTestConfig; results: Map<string, ABTestResult> }> = new Map()

export function registerExperiment(config: ABTestConfig): void {
  if (experiments.has(config.name)) {
    logger.warn({ name: config.name }, "Experiment already registered — skipping")
    return
  }

  const results = new Map<string, ABTestResult>()
  for (const variant of config.variants) {
    results.set(variant.id, {
      testName: config.name,
      variantId: variant.id,
      variantName: variant.name,
      impressions: 0,
      conversions: 0,
      conversionRate: 0,
      avgConfidence: 0,
      avgScore: 0,
    })
  }

  experiments.set(config.name, { config, results })
  logger.info({ name: config.name, variants: config.variants.length }, "Experiment registered")
}

export function getVariantConfig(experimentName: string, companyName: string): Record<string, any> | null {
  const experiment = experiments.get(experimentName)
  if (!experiment) return null

  const { config } = experiment
  const variantIndex = Math.abs(hashString(companyName)) % config.variants.length
  const variant = config.variants[variantIndex]

  return variant.config
}

export function recordImpression(experimentName: string, variantId: string, confidence?: number, score?: number): void {
  const experiment = experiments.get(experimentName)
  if (!experiment) return

  const result = experiment.results.get(variantId)
  if (!result) return

  result.impressions++
  if (confidence !== undefined) {
    result.avgConfidence = ((result.avgConfidence * (result.impressions - 1)) + confidence) / result.impressions
  }
  if (score !== undefined) {
    result.avgScore = ((result.avgScore * (result.impressions - 1)) + score) / result.impressions
  }

  incrementMetric(`ab_impression_${experimentName}_${variantId}`)
}

export function recordConversion(experimentName: string, variantId: string): void {
  const experiment = experiments.get(experimentName)
  if (!experiment) return

  const result = experiment.results.get(variantId)
  if (!result) return

  result.conversions++
  result.conversionRate = result.conversions / result.impressions

  incrementMetric(`ab_conversion_${experimentName}_${variantId}`)
}

export function getExperimentResults(experimentName: string): ABTestResult[] | null {
  const experiment = experiments.get(experimentName)
  if (!experiment) return null

  return Array.from(experiment.results.values())
}

export function getExperimentsSummary(): string[] {
  return Array.from(experiments.keys()).map(name => {
    const { config } = experiments.get(name)!
    const results = getExperimentResults(name)!
    const totalImpressions = results.reduce((s, r) => s + r.impressions, 0)
    const totalConversions = results.reduce((s, r) => s + r.conversions, 0)
    return `${name}: ${config.variants.length} variants, ${totalImpressions} impressions, ${totalConversions} conversions (${((totalConversions / Math.max(totalImpressions, 1)) * 100).toFixed(1)}%)`
  })
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

export const THRESHOLD_EXPERIMENT: ABTestConfig = {
  name: "threshold_tuning",
  description: "Compare different validation thresholds for discovery pipeline",
  startDate: new Date().toISOString(),
  trafficSplit: 100,
  minimumSampleSize: 100,
  variants: [
    {
      id: "control",
      name: "Current thresholds",
      config: {
        fastTrack: 0.9,
        autoAccept: 0.7,
        manualReview: 0.5,
      },
    },
    {
      id: "aggressive",
      name: "Aggressive discovery",
      config: {
        fastTrack: 0.85,
        autoAccept: 0.6,
        manualReview: 0.4,
        minSignalQuality: 0.3,
      },
    },
    {
      id: "conservative",
      name: "Conservative discovery",
      config: {
        fastTrack: 0.95,
        autoAccept: 0.8,
        manualReview: 0.6,
        minSignalQuality: 0.6,
      },
    },
  ],
}

export const SCORING_EXPERIMENT: ABTestConfig = {
  name: "scoring_weights",
  description: "Compare different scoring weight distributions",
  startDate: new Date().toISOString(),
  trafficSplit: 100,
  minimumSampleSize: 100,
  variants: [
    {
      id: "current",
      name: "Current weights",
      config: {
        pain: 0.30, urgency: 0.25, budget: 0.20, techFit: 0.15, automation: 0.10,
      },
    },
    {
      id: "urgency_focused",
      name: "Urgency-focused",
      config: {
        pain: 0.25, urgency: 0.35, budget: 0.20, techFit: 0.10, automation: 0.10,
      },
    },
    {
      id: "pain_focused",
      name: "Pain-focused",
      config: {
        pain: 0.40, urgency: 0.20, budget: 0.15, techFit: 0.15, automation: 0.10,
      },
    },
  ],
}
