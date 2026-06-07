import pino from "pino"

const logger = pino({ level: "info" })

interface AdapterHealthEntry {
  consecutiveFailures: number
  totalCalls: number
  totalSuccesses: number
  lastError: string | null
  lastOkAt: number | null
  lastAttemptAt: number | null
  status: "healthy" | "degraded" | "brownout" | "offline"
  brownoutUntil: number | null
}

class AdapterHealthRegistry {
  private adapters = new Map<string, AdapterHealthEntry>()

  private getOrCreate(name: string): AdapterHealthEntry {
    let entry = this.adapters.get(name)
    if (!entry) {
      entry = {
        consecutiveFailures: 0,
        totalCalls: 0,
        totalSuccesses: 0,
        lastError: null,
        lastOkAt: null,
        lastAttemptAt: null,
        status: "healthy",
        brownoutUntil: null,
      }
      this.adapters.set(name, entry)
    }
    return entry
  }

  recordSuccess(name: string): void {
    const entry = this.getOrCreate(name)
    entry.totalCalls++
    entry.totalSuccesses++
    entry.consecutiveFailures = 0
    entry.lastOkAt = Date.now()
    entry.lastAttemptAt = Date.now()
    entry.lastError = null
    if (entry.status === "brownout" || entry.status === "offline") {
      entry.status = "degraded"
      entry.brownoutUntil = null
      logger.info({ adapter: name }, "Adapter recovered — setting status to degraded")
    }
  }

  recordFailure(name: string, error: string): void {
    const entry = this.getOrCreate(name)
    entry.totalCalls++
    entry.consecutiveFailures++
    entry.lastError = error
    entry.lastAttemptAt = Date.now()

    if (entry.consecutiveFailures >= 10) {
      entry.status = "offline"
      logger.warn({ adapter: name, failures: entry.consecutiveFailures }, "Adapter taken offline — 10+ consecutive failures")
    } else if (entry.consecutiveFailures >= 5) {
      entry.status = "brownout"
      entry.brownoutUntil = Date.now() + 300_000
      logger.warn({ adapter: name, failures: entry.consecutiveFailures }, "Adapter in brownout — 5+ consecutive failures, paused for 5min")
    } else if (entry.consecutiveFailures >= 3) {
      entry.status = "degraded"
      logger.warn({ adapter: name, failures: entry.consecutiveFailures }, "Adapter degraded — 3+ consecutive failures")
    }
  }

  shouldSkip(name: string): boolean {
    const entry = this.adapters.get(name)
    if (!entry) return false
    if (entry.status === "offline") return true
    if (entry.status === "brownout" && entry.brownoutUntil && Date.now() < entry.brownoutUntil) return true
    if (entry.status === "brownout" && entry.brownoutUntil && Date.now() >= entry.brownoutUntil) {
      entry.status = "degraded"
      entry.brownoutUntil = null
      logger.info({ adapter: name }, "Brownout expired — adapter back to degraded")
      return false
    }
    return false
  }

  getStatus(name: string): string {
    return this.adapters.get(name)?.status || "healthy"
  }

  getSummary(): Record<string, { status: string; failures: number; totalCalls: number; successRate: string }> {
    const summary: Record<string, any> = {}
    for (const [name, entry] of this.adapters) {
      summary[name] = {
        status: entry.status,
        failures: entry.consecutiveFailures,
        totalCalls: entry.totalCalls,
        successRate: entry.totalCalls > 0 ? `${(entry.totalSuccesses / entry.totalCalls * 100).toFixed(0)}%` : "N/A",
      }
    }
    return summary
  }

  reset(name: string): void {
    this.adapters.delete(name)
    logger.info({ adapter: name }, "Adapter health reset")
  }
}

export const adapterHealth = new AdapterHealthRegistry()
