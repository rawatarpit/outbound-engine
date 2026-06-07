import pino from "pino"
import { getLogger, createCorrelationContext, startTrace, endTrace, getMetrics, resetMetrics } from "./tracing"
import { getSourcePrecisionSummary } from "./source-precision"
import { getFeedbackLoopReport, adjustDynamicThresholds } from "../core/validation-loop"

const logger = pino({ level: "info" })

export interface ScheduledAnalysisReport {
  period: string
  timestamp: string
  sourcePrecision: ReturnType<typeof getSourcePrecisionSummary>
  validationReport: string
  metricsSummary: Record<string, { count: number; lastValue: number; lastUpdated: string }>
}

export function generateMonthlyReport(): ScheduledAnalysisReport {
  const ctx = createCorrelationContext({ component: "scheduler" })
  const log = getLogger(ctx)
  const traceId = startTrace("monthly_report", ctx)

  log.info("Generating monthly analysis report")

  const precisionData = getSourcePrecisionSummary()
  const validationData = getFeedbackLoopReport()
  const metrics = getMetrics()

  adjustDynamicThresholds()

  endTrace(traceId, log)
  resetMetrics()

  return {
    period: "monthly",
    timestamp: new Date().toISOString(),
    sourcePrecision: precisionData,
    validationReport: validationData,
    metricsSummary: metrics,
  }
}

export function applyMonthlyTuning(report: ScheduledAnalysisReport): void {
  const log = getLogger()
  log.info({ report }, "Applying monthly tuning adjustments")

  const precisionValues = Object.values(report.sourcePrecision)
  const avgPrecision = precisionValues.length > 0
    ? precisionValues.reduce((s, p) => {
        const v = parseFloat(p.precision)
        return s + (isNaN(v) ? 0 : v)
      }, 0) / precisionValues.length
    : 0.5

  if (avgPrecision > 0.7) {
    log.info("Average precision high — thresholds are appropriately tight")
  } else if (avgPrecision < 0.3) {
    log.info("Average precision low — thresholds are appropriately loose")
  } else {
    log.info("Average precision in nominal range")
  }
}
