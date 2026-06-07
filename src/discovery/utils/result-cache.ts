import pino from "pino"

const logger = pino({ level: "info" })

const CACHE_TTL_MS = 6 * 60 * 60 * 1000

interface CacheEntry {
  result: any
  cachedAt: number
  hitCount: number
}

class ResultCache {
  private cache = new Map<string, CacheEntry>()

  private key(adapter: string, query: string): string {
    return `${adapter}::${query}`
  }

  get(adapter: string, query: string): any | null {
    const entry = this.cache.get(this.key(adapter, query))
    if (!entry) return null
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      this.cache.delete(this.key(adapter, query))
      return null
    }
    entry.hitCount++
    return entry.result
  }

  set(adapter: string, query: string, result: any): void {
    this.cache.set(this.key(adapter, query), {
      result,
      cachedAt: Date.now(),
      hitCount: 0,
    })
  }

  has(adapter: string, query: string): boolean {
    return this.get(adapter, query) !== null
  }

  clear(): void {
    this.cache.clear()
  }

  prune(): number {
    let pruned = 0
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAt > CACHE_TTL_MS) {
        this.cache.delete(key)
        pruned++
      }
    }
    return pruned
  }

  size(): number {
    return this.cache.size
  }

  getStats(): { size: number; hits: number } {
    let totalHits = 0
    for (const entry of this.cache.values()) {
      totalHits += entry.hitCount
    }
    return { size: this.cache.size, hits: totalHits }
  }
}

export const resultCache = new ResultCache()
