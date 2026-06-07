import pino from "pino"
import { randomHeaders } from "./userAgent"

const logger = pino({ level: "info" })

interface SourceLimit {
  maxRequests: number
  windowMs: number
  backoffMs: number
}

const SOURCE_LIMITS: Record<string, SourceLimit> = {
  yc:           { maxRequests: 60,  windowMs: 60_000,  backoffMs: 1_000 },
  indeed:       { maxRequests: 5,   windowMs: 60_000,  backoffMs: 60_000 },
  crunchbase:   { maxRequests: 2,   windowMs: 60_000,  backoffMs: 60_000 },
  wellfound:    { maxRequests: 10,  windowMs: 60_000,  backoffMs: 30_000 },
  producthunt:  { maxRequests: 10,  windowMs: 60_000,  backoffMs: 10_000 },
  github:       { maxRequests: 60,  windowMs: 60_000,  backoffMs: 60_000 },
  pushshift:    { maxRequests: 120, windowMs: 60_000,  backoffMs: 1_000 },
  techcrunch:   { maxRequests: 30,  windowMs: 60_000,  backoffMs: 2_000 },
  stackshare:   { maxRequests: 5,   windowMs: 60_000,  backoffMs: 30_000 },
  google:       { maxRequests: 10,  windowMs: 60_000,  backoffMs: 30_000 },
  reddit:       { maxRequests: 10,  windowMs: 60_000,  backoffMs: 30_000 },
  hackernews:   { maxRequests: 60,  windowMs: 60_000,  backoffMs: 1_000 },
  searxng:      { maxRequests: 30,  windowMs: 60_000,  backoffMs: 2_000 },
  default:      { maxRequests: 10,  windowMs: 60_000,  backoffMs: 10_000 },
}

interface SlidingWindow {
  timestamps: number[]
}

class AdaptiveRateLimiter {
  private windows = new Map<string, SlidingWindow>()
  private lastBackoff = new Map<string, number>()

  getLimit(source: string): SourceLimit {
    return SOURCE_LIMITS[source.toLowerCase()] || SOURCE_LIMITS.default
  }

  private getWindow(source: string): SlidingWindow {
    let w = this.windows.get(source.toLowerCase())
    if (!w) {
      w = { timestamps: [] }
      this.windows.set(source.toLowerCase(), w)
    }
    return w
  }

  private prune(source: string): void {
    const w = this.getWindow(source)
    const limit = this.getLimit(source)
    const cutoff = Date.now() - limit.windowMs
    w.timestamps = w.timestamps.filter(t => t > cutoff)
  }

  async wait(source: string): Promise<void> {
    source = source.toLowerCase()
    const limit = this.getLimit(source)
    const w = this.getWindow(source)

    this.prune(source)

    const backoffUntil = this.lastBackoff.get(source) || 0
    if (backoffUntil > Date.now()) {
      const waitMs = backoffUntil - Date.now()
      logger.info({ source, waitMs }, "Rate limiter backoff active, waiting")
      await sleep(waitMs)
    }

    if (w.timestamps.length >= limit.maxRequests) {
      const oldest = w.timestamps[0]
      const waitMs = oldest + limit.windowMs - Date.now()
      if (waitMs > 0) {
        logger.info({ source, waitMs, limit: limit.maxRequests }, "Rate limit hit, waiting")
        await sleep(waitMs + limit.backoffMs)
      }
      this.prune(source)
    }

    w.timestamps.push(Date.now())
  }

  handle429(source: string): void {
    const limit = this.getLimit(source)
    const backoffDuration = Math.max(limit.backoffMs, 60_000)
    this.lastBackoff.set(source.toLowerCase(), Date.now() + backoffDuration)
    logger.warn({ source, backoffMs: backoffDuration }, "Received 429, backing off")
  }

  reset(source: string): void {
    this.windows.delete(source.toLowerCase())
    this.lastBackoff.delete(source.toLowerCase())
  }

  getStats(source: string): { currentLoad: number; maxLoad: number; backoffActive: boolean } {
    this.prune(source)
    const w = this.getWindow(source)
    const limit = this.getLimit(source)
    const backoffUntil = this.lastBackoff.get(source.toLowerCase()) || 0
    return {
      currentLoad: w.timestamps.length,
      maxLoad: limit.maxRequests,
      backoffActive: backoffUntil > Date.now(),
    }
  }
}

export const rateLimiter = new AdaptiveRateLimiter()

export async function withRateLimit<T>(
  source: string,
  fn: () => Promise<T>
): Promise<T> {
  await rateLimiter.wait(source)
  try {
    const result = await fn()
    return result
  } catch (err: any) {
    if (err?.response?.status === 429) {
      rateLimiter.handle429(source)
    }
    throw err
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
