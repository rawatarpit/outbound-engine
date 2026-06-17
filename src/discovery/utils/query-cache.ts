import pino from "pino"

const logger = pino({ level: "info" })

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

export class QueryCache {
  private stores = new Map<string, Map<string, CacheEntry<any>>>()
  private hits = 0
  private misses = 0

  getOrFetch<T>(
    namespace: string,
    fetcher: () => Promise<T>,
    ...keyParts: string[]
  ): Promise<T> {
    const key = keyParts.join(":")
    const store = this.getStore(namespace)
    const entry = store.get(key)
    if (entry && entry.expiresAt > Date.now()) {
      this.hits++
      return Promise.resolve(entry.data as T)
    }
    this.misses++
    return fetcher().then((data) => {
      store.set(key, { data, expiresAt: Date.now() + 30_000 })
      return data
    })
  }

  invalidate(namespace: string): void {
    this.stores.delete(namespace)
  }

  stats(): { hits: number; misses: number; namespaces: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      namespaces: this.stores.size,
    }
  }

  private getStore(namespace: string): Map<string, CacheEntry<any>> {
    let store = this.stores.get(namespace)
    if (!store) {
      store = new Map()
      this.stores.set(namespace, store)
    }
    return store
  }
}

export const queryCache = new QueryCache()
