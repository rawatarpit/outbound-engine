import pino from "pino"

const logger = pino({ name: "continuous-listeners" })

interface ListenerConfig {
  name: string
  intervalMs: number
  handler: () => Promise<void>
  enabled: boolean
}

const listeners: ListenerConfig[] = []

let running = false
let intervals: ReturnType<typeof setInterval>[] = []

export function registerListener(config: ListenerConfig): void {
  listeners.push(config)
  logger.info({ name: config.name, intervalMs: config.intervalMs }, "Listener registered")
}

export async function startAll(): Promise<void> {
  if (running) return
  running = true
  logger.info({ count: listeners.length }, "Starting all continuous listeners")

  for (const listener of listeners) {
    if (!listener.enabled) continue

    const tick = async () => {
      try {
        await listener.handler()
      } catch (err: any) {
        logger.error({ name: listener.name, error: err.message }, "Listener tick failed")
      }
    }

    await tick()
    intervals.push(setInterval(tick, listener.intervalMs))
  }

  logger.info({ count: intervals.length }, "Continuous listeners started")
}

export function stopAll(): void {
  for (const interval of intervals) clearInterval(interval)
  intervals = []
  running = false
  logger.info("Continuous listeners stopped")
}

export function registerDefaultListeners(handlers: {
  onHNHiring?: () => Promise<void>
  onRedditPain?: () => Promise<void>
  onRecentYC?: () => Promise<void>
  onFundingNews?: () => Promise<void>
}): void {
  const FIVE_MIN = 5 * 60 * 1000
  const FIFTEEN_MIN = 15 * 60 * 1000
  const THIRTY_MIN = 30 * 60 * 1000

  if (handlers.onHNHiring) {
    registerListener({ name: "hn-hiring", intervalMs: THIRTY_MIN, handler: handlers.onHNHiring, enabled: true })
  }
  if (handlers.onRedditPain) {
    registerListener({ name: "reddit-pain", intervalMs: FIVE_MIN, handler: handlers.onRedditPain, enabled: true })
  }
  if (handlers.onRecentYC) {
    registerListener({ name: "yc-recent", intervalMs: FIFTEEN_MIN, handler: handlers.onRecentYC, enabled: true })
  }
  if (handlers.onFundingNews) {
    registerListener({ name: "funding-news", intervalMs: THIRTY_MIN, handler: handlers.onFundingNews, enabled: true })
  }
}

export function isRunning(): boolean {
  return running
}
