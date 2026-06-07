import fs from "fs"
import path from "path"
import pino from "pino"
import axios from "axios"
import { load } from "cheerio"
import { domainHasEmail } from "./domain-validator"
import { normalizeDomain } from "../normalizer"
import { randomHeaders } from "./userAgent"

const logger = pino({ level: "info" })

const CACHE_PATH = path.resolve(process.cwd(), ".domain-cache.json")
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface DomainCacheEntry {
  domain: string
  resolvedAt: number
  method: string
}

class DomainResolver {
  private cache = new Map<string, DomainCacheEntry>()
  private loaded = false
  private saveTimer: NodeJS.Timeout | null = null

  constructor() {
    this.loadCache()
  }

  private loadCache(): void {
    try {
      if (fs.existsSync(CACHE_PATH)) {
        const raw = fs.readFileSync(CACHE_PATH, "utf-8")
        const data = JSON.parse(raw)
        for (const [key, val] of Object.entries(data)) {
          this.cache.set(key, val as DomainCacheEntry)
        }
        this.loaded = true
        logger.info({ size: this.cache.size }, "Domain resolver cache loaded")
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "Failed to load domain cache")
    }
  }

  private saveCache(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      try {
        const obj: Record<string, DomainCacheEntry> = {}
        for (const [key, val] of this.cache) {
          obj[key] = val
        }
        fs.writeFileSync(CACHE_PATH, JSON.stringify(obj, null, 2))
      } catch (err: any) {
        logger.warn({ error: err.message }, "Failed to save domain cache")
      }
    }, 2000)
  }

  private isExpired(entry: DomainCacheEntry): boolean {
    return Date.now() - entry.resolvedAt > CACHE_TTL_MS
  }

  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/--+/g, "-")
      .replace(/^-|-$/g, "")
  }

  getCached(name: string): string | null {
    const key = name.toLowerCase().trim()
    const entry = this.cache.get(key)
    if (entry && !this.isExpired(entry)) {
      return entry.domain
    }
    return null
  }

  async resolve(name: string): Promise<string | null> {
    const key = name.toLowerCase().trim()
    if (!key || key.length < 2) return null

    const cached = this.getCached(key)
    if (cached) return cached

    const sanitized = this.sanitizeName(name)
    if (!sanitized) return null

    const candidate = `${sanitized}.com`
    if (candidate.length > 6) {
      try {
        const hasMx = await domainHasEmail(candidate)
        if (hasMx) {
          this.set(key, candidate, "mx_check")
          return candidate
        }
      } catch {}
    }

    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`"${name}" company website`)}`
      const res = await axios.get(searchUrl, {
        headers: { ...randomHeaders(), "Accept": "text/html" },
        timeout: 10000,
      })
      const $ = load(res.data)
      const foundDomains: string[] = []
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href")
        if (!href) return
        const match = href.match(/https?:\/\/([^\/"\s&?]+)/)
        if (match) {
          const d = normalizeDomain(match[0])
          if (d) foundDomains.push(d)
        }
      })
      const filtered = foundDomains.filter(d =>
        !d.includes("google") && !d.includes("youtube") &&
        !d.includes("facebook") && !d.includes("linkedin") &&
        !d.includes("twitter") && !d.includes("instagram") &&
        !d.includes("reddit") && !d.includes("github")
      )
      if (filtered.length > 0) {
        this.set(key, filtered[0], "google_search")
        return filtered[0]
      }
    } catch {}

    try {
      const cbSlug = key.replace(/[^a-z0-9]/g, "-").replace(/--+/g, "-").replace(/^-|-$/g, "")
      if (cbSlug && cbSlug.length > 2) {
        const cbUrl = `https://www.crunchbase.com/organization/${cbSlug}`
        const res = await axios.get(cbUrl, {
          headers: randomHeaders(),
          timeout: 10000,
        })
        const websiteMatch = res.data.match(/"website":\s*"([^"]+)"/)
        if (websiteMatch) {
          const domain = normalizeDomain(websiteMatch[1])
          if (domain) {
            this.set(key, domain, "crunchbase")
            return domain
          }
        }
      }
    } catch {}

    return null
  }

  private set(name: string, domain: string, method: string): void {
    this.cache.set(name.toLowerCase().trim(), { domain, resolvedAt: Date.now(), method })
    this.saveCache()
  }

  async resolveBulk(names: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>()
    for (const name of names) {
      const domain = await this.resolve(name)
      results.set(name, domain)
    }
    return results
  }

  getCacheSize(): number {
    return this.cache.size
  }

  clearExpired(): number {
    let cleared = 0
    for (const [key, val] of this.cache) {
      if (this.isExpired(val)) {
        this.cache.delete(key)
        cleared++
      }
    }
    if (cleared > 0) this.saveCache()
    return cleared
  }
}

export const domainResolver = new DomainResolver()
