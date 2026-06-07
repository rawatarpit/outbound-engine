import pino from "pino"
import { getToolByName } from "../../harness/toolRegistry"

const logger = pino({ level: "debug" })

export interface ScraplingResult {
  title?: string
  url?: string
  company?: string
  body?: string
}

export interface ScraplingResponse {
  success: boolean
  results: ScraplingResult[]
  source: string
  query: string
  error?: string
}

async function searxngSearch(
  query: string,
  maxResults: number = 10
): Promise<ScraplingResult[]> {
  try {
    const results = await getToolByName("search_searxng")!.executor({ query, max_results: maxResults })
    return (results as ScraplingResult[]) || []
  } catch (err: any) {
    logger.warn({ query, error: err.message }, "SearXNG search failed, falling back to DDG")
    return []
  }
}

async function ddgSearch(
  query: string,
  source: "google" | "jobs" | "news" = "google",
  maxResults: number = 10
): Promise<ScraplingResult[]> {
  try {
    const results = await getToolByName("search_ddg")!.executor({ query, source, max_results: maxResults })
    return (results as ScraplingResult[]) || []
  } catch (err: any) {
    logger.error({ query, error: err.message }, "DDG execution error")
    return []
  }
}

export async function executeScraplingSearch(
  query: string,
  source: "google" | "jobs" | "news" = "google",
  maxResults: number = 10
): Promise<ScraplingResult[]> {
  // Try DDG first, fall back to SearXNG
  const ddgResults = await ddgSearch(query, source, maxResults)
  if (ddgResults.length > 0) {
    logger.info({ query, count: ddgResults.length }, "DDG search completed")
    return ddgResults.slice(0, maxResults)
  }

  const searxngResults = await searxngSearch(query, maxResults)
  if (searxngResults.length > 0) {
    logger.info({ query, count: searxngResults.length }, "SearXNG search completed")
    return searxngResults.slice(0, maxResults)
  }

  return []
}
