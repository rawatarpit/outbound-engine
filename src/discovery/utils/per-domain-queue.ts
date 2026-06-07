import pino from "pino"
import fs from "fs"
import path from "path"

const logger = pino({ level: "info" })

const QUEUE_FILE = path.resolve(process.cwd(), "data", "per-domain-queue.json")

interface DomainQueueConfig {
  maxConcurrency: number
  delayBetweenRequests: number
  maxRetries: number
  backoffBaseMs: number
}

interface DomainJob {
  id: string
  domain: string
  url: string
  type: "scrape" | "search" | "validate"
  priority: number
  status: "pending" | "processing" | "completed" | "failed" | "rate_limited"
  createdAt: number
  startedAt?: number
  completedAt?: number
  retries: number
  lastError?: string
}

interface DomainState {
  queue: DomainJob[]
  activeCount: number
  lastRequestAt: number
  consecutiveErrors: number
  rateLimitedUntil: number
  config: DomainQueueConfig
  totalProcessed: number
  totalErrors: number
}

type DomainQueueStore = Record<string, DomainState>

const DEFAULT_DOMAIN_CONFIG: DomainQueueConfig = {
  maxConcurrency: 2,
  delayBetweenRequests: 1500,
  maxRetries: 3,
  backoffBaseMs: 5000,
}

const HIGH_PRIORITY_DOMAINS = ["linkedin.com", "crunchbase.com", "github.com"]

function load(): DomainQueueStore {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf-8"))
    }
  } catch { }
  return {}
}

function save(store: DomainQueueStore): void {
  const dir = path.dirname(QUEUE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(store, null, 2))
}

function getDomainFromUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function getOrCreateState(store: DomainQueueStore, domain: string): DomainState {
  if (!store[domain]) {
    store[domain] = {
      queue: [],
      activeCount: 0,
      lastRequestAt: 0,
      consecutiveErrors: 0,
      rateLimitedUntil: 0,
      config: {
        ...DEFAULT_DOMAIN_CONFIG,
        maxConcurrency: HIGH_PRIORITY_DOMAINS.includes(domain) ? 5 : 2,
        delayBetweenRequests: HIGH_PRIORITY_DOMAINS.includes(domain) ? 500 : 1500,
      },
      totalProcessed: 0,
      totalErrors: 0,
    }
  }
  return store[domain]
}

export function enqueueRequest(url: string, type: DomainJob["type"] = "scrape", priority: number = 0): string {
  const store = load()
  const domain = getDomainFromUrl(url)
  const state = getOrCreateState(store, domain)

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  state.queue.push({
    id,
    domain,
    url,
    type,
    priority,
    status: "pending",
    createdAt: Date.now(),
    retries: 0,
  })

  state.queue.sort((a, b) => b.priority - a.priority)
  save(store)

  logger.debug({ jobId: id, domain, url }, "Enqueued domain request")
  return id
}

export function getNextJob(): DomainJob | null {
  const store = load()
  let bestJob: DomainJob | null = null
  let bestDomain = ""

  for (const [domain, state] of Object.entries(store)) {
    if (state.activeCount >= state.config.maxConcurrency) continue
    if (state.rateLimitedUntil > Date.now()) continue
    if (Date.now() - state.lastRequestAt < state.config.delayBetweenRequests) continue

    const pendingJob = state.queue.find(j => j.status === "pending")
    if (pendingJob) {
      if (!bestJob || pendingJob.priority > bestJob.priority) {
        bestJob = pendingJob
        bestDomain = domain
      }
    }
  }

  if (bestJob && bestDomain) {
    bestJob.status = "processing"
    bestJob.startedAt = Date.now()
    store[bestDomain].activeCount++
    store[bestDomain].lastRequestAt = Date.now()
    save(store)
    return bestJob
  }

  return null
}

export function completeJob(jobId: string): void {
  const store = load()
  for (const state of Object.values(store)) {
    const idx = state.queue.findIndex(j => j.id === jobId)
    if (idx !== -1) {
      state.queue[idx].status = "completed"
      state.queue[idx].completedAt = Date.now()
      state.activeCount = Math.max(0, state.activeCount - 1)
      state.totalProcessed++
      state.consecutiveErrors = 0
      state.lastRequestAt = Date.now()
      save(store)
      logger.debug({ jobId, domain: state.queue[idx].domain }, "Job completed")
      return
    }
  }
}

export function failJob(jobId: string, error: string, isRateLimit: boolean = false): void {
  const store = load()
  for (const [domain, state] of Object.entries(store)) {
    const idx = state.queue.findIndex(j => j.id === jobId)
    if (idx !== -1) {
      const job = state.queue[idx]
      job.lastError = error
      job.retries++
      state.activeCount = Math.max(0, state.activeCount - 1)
      state.totalErrors++
      state.consecutiveErrors++
      state.lastRequestAt = Date.now()

      if (isRateLimit) {
        const backoffMs = Math.min(
          state.config.backoffBaseMs * Math.pow(2, state.consecutiveErrors),
          300000
        )
        state.rateLimitedUntil = Date.now() + backoffMs + Math.random() * 1000
        job.status = "rate_limited"
        logger.warn({ domain, backoffMs, consecutiveErrors: state.consecutiveErrors }, "Domain rate limited")
      } else if (job.retries >= state.config.maxRetries) {
        job.status = "failed"
        logger.error({ domain, jobId, error, retries: job.retries }, "Job failed permanently")
      } else {
        job.status = "pending"
        logger.warn({ domain, jobId, error, retry: job.retries }, "Job will be retried")
      }

      save(store)
      return
    }
  }
}

export function getDomainStats(): Record<string, { queueLength: number; active: number; processed: number; errors: number; rateLimited: boolean }> {
  const store = load()
  const stats: Record<string, any> = {}
  for (const [domain, state] of Object.entries(store)) {
    stats[domain] = {
      queueLength: state.queue.filter(j => j.status === "pending").length,
      active: state.activeCount,
      processed: state.totalProcessed,
      errors: state.totalErrors,
      rateLimited: state.rateLimitedUntil > Date.now(),
    }
  }
  return stats
}

export function resetDomainState(domain: string): void {
  const store = load()
  delete store[domain]
  save(store)
  logger.info({ domain }, "Domain state reset")
}

// Adaptive backoff based on HTTP 429/5xx responses
export async function waitForDomain(domain: string): Promise<void> {
  const store = load()
  const state = getOrCreateState(store, domain)
  const now = Date.now()

  if (state.rateLimitedUntil > now) {
    const waitMs = state.rateLimitedUntil - now
    logger.info({ domain, waitMs }, "Waiting for domain rate limit to expire")
    await sleep(waitMs)
  }

  const timeSinceLastRequest = now - state.lastRequestAt
  if (timeSinceLastRequest < state.config.delayBetweenRequests) {
    const waitMs = state.config.delayBetweenRequests - timeSinceLastRequest
    await sleep(waitMs)
  }

  if (state.activeCount >= state.config.maxConcurrency) {
    const waitMs = state.config.delayBetweenRequests + Math.random() * 500
    await sleep(waitMs)
  }
}

export function handleResponse(domain: string, statusCode: number): void {
  const store = load()
  const state = getOrCreateState(store, domain)

  if (statusCode === 429) {
    const backoffMs = Math.min(
      state.config.backoffBaseMs * Math.pow(2, state.consecutiveErrors + 1),
      300000
    )
    state.rateLimitedUntil = Date.now() + backoffMs + Math.random() * 1000
    state.consecutiveErrors++
    logger.warn({ domain, backoffMs, consecutiveErrors: state.consecutiveErrors }, "429 received, applying backoff")
  } else if (statusCode >= 500) {
    state.consecutiveErrors++
    state.config.delayBetweenRequests = Math.min(state.config.delayBetweenRequests * 1.5, 30000)
    logger.warn({ domain, statusCode, newDelay: state.config.delayBetweenRequests }, "5xx received, increasing delay")
  } else if (statusCode >= 200 && statusCode < 300) {
    state.consecutiveErrors = Math.max(0, state.consecutiveErrors - 1)
    if (state.config.delayBetweenRequests > DEFAULT_DOMAIN_CONFIG.delayBetweenRequests) {
      state.config.delayBetweenRequests = Math.max(
        DEFAULT_DOMAIN_CONFIG.delayBetweenRequests,
        state.config.delayBetweenRequests * 0.9
      )
    }
  }

  save(store)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
