import type { GeneratedQuery, QueryGenerationOutput } from "./schema"

interface CachedQuerySet {
  intentId: string
  queries: GeneratedQuery[]
  avoidPatterns: string[]
  generatedAt: Date
  runId: string
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000

class QueryCache {
  private cache = new Map<string, CachedQuerySet>()

  set(intentId: string, runId: string, output: QueryGenerationOutput): void {
    this.cache.set(intentId, {
      intentId,
      queries: output.queries,
      avoidPatterns: output.avoid_patterns,
      generatedAt: new Date(),
      runId,
    })
  }

  get(intentId: string, adapter: string): GeneratedQuery[] {
    const entry = this.cache.get(intentId)
    if (!entry) return []
    if (Date.now() - entry.generatedAt.getTime() > CACHE_TTL_MS) {
      this.cache.delete(intentId)
      return []
    }
    return entry.queries
      .filter(q => q.adapter === adapter)
      .sort((a, b) => b.priority - a.priority)
  }

  getAll(intentId: string): GeneratedQuery[] {
    const entry = this.cache.get(intentId)
    if (!entry) return []
    if (Date.now() - entry.generatedAt.getTime() > CACHE_TTL_MS) {
      this.cache.delete(intentId)
      return []
    }
    return entry.queries.sort((a, b) => b.priority - a.priority)
  }

  getAvoidPatterns(intentId: string): string[] {
    return this.cache.get(intentId)?.avoidPatterns ?? []
  }

  has(intentId: string): boolean {
    const entry = this.cache.get(intentId)
    if (!entry) return false
    return Date.now() - entry.generatedAt.getTime() < CACHE_TTL_MS
  }
}

export const queryCache = new QueryCache()
