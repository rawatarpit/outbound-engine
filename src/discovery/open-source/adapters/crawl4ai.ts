import { execFile } from "child_process"
import { promisify } from "util"
import path from "path"
import pino from "pino"
import { scrapeUrl } from "../../../core/utils/scraper"

const execFileAsync = promisify(execFile)
const logger = pino({ level: "info" })

const SCRIPT_PATH = path.resolve(__dirname, "../../../../src/discovery/open-source/scripts/crawl4ai_scrape.py")

export interface Crawl4AIResult {
  url: string
  title: string
  markdown: string
  success: boolean
  error?: string
}

async function callCrawl4AI(url: string, deep: boolean = false): Promise<Crawl4AIResult> {
  const args = [SCRIPT_PATH, url]
  if (deep) args.push("--deep")
  try {
    const { stdout } = await execFileAsync("python3", args, { timeout: 60000 })
    // Crawl4AI prints log lines to stdout before the JSON — take the last line
    const lines = stdout.trim().split("\n")
    const lastLine = lines[lines.length - 1]
    const parsed = JSON.parse(lastLine)
    if (parsed.error) {
      logger.warn({ url, error: parsed.error }, "Crawl4AI returned error, falling back to built-in scraper")
      return fallbackScrape(url)
    }
    return parsed
  } catch (err: any) {
    logger.warn({ url, error: err.message }, "Crawl4AI subprocess failed, falling back to built-in scraper")
    return fallbackScrape(url)
  }
}

async function fallbackScrape(url: string): Promise<Crawl4AIResult> {
  const html = await scrapeUrl(url, 10000)
  const text = html
    ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    : ""
  return {
    url,
    title: text.split(".")[0]?.substring(0, 100) || url,
    markdown: text.substring(0, 10000),
    success: !!html,
  }
}

export async function scrapeCompanyWebsite(domain: string): Promise<Crawl4AIResult> {
  const urls = [
    `https://${domain}`,
    `https://www.${domain}`,
    `http://${domain}`,
  ]

  for (const url of urls) {
    const result = await callCrawl4AI(url)
    if (result.success && result.markdown.length > 100) {
      return result
    }
  }

  return { url: `https://${domain}`, title: domain, markdown: "", success: false, error: "All URLs failed" }
}

export async function deepCrawlCompany(domain: string): Promise<Crawl4AIResult[]> {
  const results: Crawl4AIResult[] = []

  const pages = [
    `https://${domain}/team`,
    `https://${domain}/about`,
    `https://${domain}/company`,
    `https://${domain}/leadership`,
    `https://${domain}/people`,
    `https://${domain}/careers`,
    `https://${domain}/products`,
  ]

  for (const url of pages) {
    const result = await callCrawl4AI(url)
    if (result.success && result.markdown.length > 50) {
      results.push(result)
    }
  }

  return results
}
