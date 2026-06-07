import pino from "pino"
import crypto from "crypto"

/* =========================================================
   CORRELATION ID LOGGER
   Structured logging with per-request correlation IDs
   and performance tracing
   ========================================================= */

const baseLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level(label) {
      return { level: label }
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})

export interface CorrelationContext {
  correlationId: string
  brandId?: string
  intentId?: string
  runId?: string
  source?: string
  component?: string
}

export function createCorrelationContext(extra?: Partial<CorrelationContext>): CorrelationContext {
  return {
    correlationId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ...extra,
  }
}

export function getLogger(ctx?: CorrelationContext): pino.Logger {
  if (!ctx) return baseLogger

  const bindings: Record<string, any> = {
    cid: ctx.correlationId,
  }
  if (ctx.brandId) bindings.brand = ctx.brandId
  if (ctx.intentId) bindings.intent = ctx.intentId
  if (ctx.runId) bindings.run = ctx.runId
  if (ctx.source) bindings.source = ctx.source
  if (ctx.component) bindings.component = ctx.component

  return baseLogger.child(bindings)
}

/* =========================================================
   PERFORMANCE TRACING
   ========================================================= */

const traces = new Map<string, { start: number; entries: { label: string; duration: number }[] }>()

export function startTrace(label: string, ctx?: CorrelationContext): string {
  const traceId = ctx?.correlationId || createCorrelationContext().correlationId
  traces.set(traceId, { start: Date.now(), entries: [] })
  return traceId
}

export function addTracePoint(traceId: string, label: string): void {
  const trace = traces.get(traceId)
  if (!trace) return
  const duration = Date.now() - trace.start
  trace.entries.push({ label, duration })
}

export function endTrace(traceId: string, logger?: pino.Logger): { totalMs: number; entries: { label: string; duration: number }[] } {
  const trace = traces.get(traceId)
  if (!trace) return { totalMs: 0, entries: [] }
  const totalMs = Date.now() - trace.start
  traces.delete(traceId)

  if (logger) {
    logger.info(
      { trace: trace.entries, totalMs },
      "Trace completed"
    )
  }

  return { totalMs, entries: trace.entries }
}

/* =========================================================
   METRICS COUNTER
   ========================================================= */

const metrics = new Map<string, { count: number; lastValue: number; lastUpdated: number }>()

export function incrementMetric(name: string, value: number = 1): void {
  const entry = metrics.get(name) || { count: 0, lastValue: 0, lastUpdated: Date.now() }
  entry.count += value
  entry.lastValue = value
  entry.lastUpdated = Date.now()
  metrics.set(name, entry)
}

export function getMetrics(): Record<string, { count: number; lastValue: number; lastUpdated: string }> {
  const result: Record<string, any> = {}
  for (const [name, entry] of metrics) {
    result[name] = {
      count: entry.count,
      lastValue: entry.lastValue,
      lastUpdated: new Date(entry.lastUpdated).toISOString(),
    }
  }
  return result
}

export function resetMetrics(): void {
  metrics.clear()
}
