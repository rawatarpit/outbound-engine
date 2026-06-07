import pino from "pino"
import axios from "axios"
import { load } from "cheerio"
import { randomUA, randomHeaders } from "./userAgent"
import { waitForDomain as waitDomain, handleResponse } from "./per-domain-queue"

const logger = pino({ level: "debug" })

// Response cache with content hashing and TTL
const responseCache = new Map<string, { body: string; cachedAt: number; contentType: string }>()
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

const TARGET_PATHS = ["/careers", "/blog", "/changelog", "/about", "/team", "/leadership", "/company", "/jobs"]

/* =========================================================
   RESPONSE CACHE
   ========================================================= */

function getCacheKey(url: string): string {
  const u = url.toLowerCase().replace(/\/$/, "")
  return u
}

function getFromCache(url: string): { body: string; contentType: string } | null {
  const key = getCacheKey(url)
  const entry = responseCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    responseCache.delete(key)
    return null
  }
  return { body: entry.body, contentType: entry.contentType }
}

function setCache(url: string, body: string, contentType: string): void {
  const key = getCacheKey(url)
  responseCache.set(key, { body, cachedAt: Date.now(), contentType })
}

export function clearCache(): void {
  responseCache.clear()
  logger.info("Smart crawler cache cleared")
}

export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: responseCache.size,
    entries: Array.from(responseCache.keys()).slice(0, 20),
  }
}

/* =========================================================
   HTTP-FIRST CRAWLER
   ========================================================= */

export interface CrawlResult {
  url: string
  body: string
  contentType: string
  title: string
  text: string
  fromCache: boolean
  method: "axios" | "playwright"
}

async function httpCrawl(url: string, timeoutMs: number = 15000): Promise<CrawlResult | null> {
  try {
    const response = await axios.get(url, {
      headers: {
        ...randomHeaders(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: timeoutMs,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
      responseType: "text",
    })

    const contentType = response.headers["content-type"] || ""
    const body = typeof response.data === "string" ? response.data : ""

    if (!body || body.length < 100) return null

    const $ = load(body)
    $("script, style, noscript, nav, footer, header, iframe").remove()

    const title = $("title").text().trim().slice(0, 200)
    const text = $("body").text().replace(/\s+/g, " ").trim()

    return {
      url,
      body,
      contentType,
      title: title || url,
      text: text.slice(0, 16000),
      fromCache: false,
      method: "axios",
    }
  } catch (err: any) {
    logger.debug({ url, error: err.message?.slice(0, 80) }, "HTTP crawl failed")
    return null
  }
}

async function playwrightCrawl(url: string, timeoutMs: number = 20000): Promise<CrawlResult | null> {
  try {
    const { chromium } = await import("playwright")
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    })
    try {
      const page = await browser.newPage({
        userAgent: randomUA(),
        viewport: { width: 1280, height: 720 },
      })
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs })
      await page.waitForTimeout(2000)

      const title = await page.title()
      const text = await page.evaluate(() => {
        document.querySelectorAll("script, style, noscript, nav, footer, header, iframe").forEach(el => el.remove())
        return document.body?.innerText?.replace(/\s+/g, " ").trim() || ""
      })
      const body = await page.content()

      return {
        url,
        body,
        contentType: "text/html",
        title: title.slice(0, 200),
        text: text.slice(0, 16000),
        fromCache: false,
        method: "playwright",
      }
    } finally {
      await browser.close()
    }
  } catch (err: any) {
    logger.debug({ url, error: err.message?.slice(0, 80) }, "Playwright crawl failed")
    return null
  }
}

/* =========================================================
   MAIN CRAWL FUNCTION
   ========================================================= */

export async function smartCrawl(url: string, useBrowser: boolean = false): Promise<CrawlResult | null> {
  const cached = getFromCache(url)
  if (cached) {
    const $ = load(cached.body)
    $("script, style, noscript, nav, footer, header, iframe").remove()
    const title = $("title").text().trim().slice(0, 200)
    const text = $("body").text().replace(/\s+/g, " ").trim()
    return {
      url,
      body: cached.body,
      contentType: cached.contentType,
      title: title || url,
      text: text.slice(0, 16000),
      fromCache: true,
      method: "axios",
    }
  }

  // HTTP-first approach
  let result: CrawlResult | null = null
  if (!useBrowser) {
    result = await httpCrawl(url)
    if (result) {
      setCache(url, result.body, result.contentType)
      return result
    }
  }

  // Browser fallback for JS-heavy pages
  result = await playwrightCrawl(url)
  if (result) {
    setCache(url, result.body, result.contentType)
    return result
  }

  return null
}

/* =========================================================
   TARGETED PATH CRAWLING
   ========================================================= */

export async function smartCrawlTargeted(domain: string): Promise<Record<string, CrawlResult | null>> {
  const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`
  const results: Record<string, CrawlResult | null> = {}

  // Always crawl the homepage first
  results["/"] = await smartCrawl(baseUrl)

  // Crawl target paths
  for (const path of TARGET_PATHS) {
    const url = `${baseUrl}${path}`
    results[path] = await smartCrawl(url)
  }

  return results
}

/* =========================================================
   BATCH CRAWL WITH DOMAIN QUEUE
   ========================================================= */

export async function batchSmartCrawl(
  urls: string[],
  concurrency: number = 3
): Promise<Map<string, CrawlResult | null>> {
  const results = new Map<string, CrawlResult | null>()

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        await waitDomain(getDomainFromUrl(url))
        const result = await smartCrawl(url)
        if (result) {
          const statusCode = result.method === "axios" ? 200 : 200
          handleResponse(getDomainFromUrl(url), statusCode)
        }
        return { url, result }
      })
    )
    for (const { url, result } of batchResults) {
      results.set(url, result)
    }
  }

  return results
}

function getDomainFromUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
