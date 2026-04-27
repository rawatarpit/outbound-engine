import axios from "axios"
import * as cheerio from "cheerio"
import pino from "pino"
import type { Executor, BatchExecutor } from "../../registry"
import type { DiscoveryResult } from "../../types"
import { DiscoveryError } from "../../errors"
import { z } from "zod"

const logger = pino({ level: "info" })

export const JOBSPY_MAX_ITEMS = 200

export const jobSpySchema = z.object({
  keywords: z.string().min(1),
  location: z.string().optional(),
  site: z.enum(["linkedin", "indeed", "glassdoor", "all"]).default("all"),
  recentDays: z.number().int().min(1).max(30).default(7),
})

export type JobSpyConfig = z.infer<typeof jobSpySchema>

interface JobPosting {
  title: string
  company: string
  location: string
  url: string
  postedDate: string
  site: string
  snippet: string
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
]

async function scrapeUrl(url: string): Promise<string | null> {
  for (const ua of USER_AGENTS) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent": ua,
          "Accept-Language": "en-US,en;q=0.9",
        },
      })
      return response.data
    } catch {
      // Try next user agent
    }
  }
  return null
}

async function scrapeLinkedIn(query: string): Promise<JobPosting[]> {
  const results: JobPosting[] = []
  const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&f_TPR=r2592000`

  const html = await scrapeUrl(url)
  if (!html) return results

  const $ = cheerio.load(html)
  $(".job-card-container").each((_, el) => {
    const title = $(el).find(".job-card-list__title").text().trim()
    const company = $(el).find(".job-card-container__company-name").text().trim()
    const location = $(el).find(".job-card-container__metadata-item").text().trim()
    const link = $(el).find(".job-card-list__title").attr("href") || ""

    if (title && company) {
      results.push({
        title,
        company,
        location,
        url: link.startsWith("http") ? link : `https://linkedin.com${link}`,
        postedDate: new Date().toISOString(),
        site: "linkedin",
        snippet: `${title} at ${company}`,
      })
    }
  })

  logger.info({ stage: "LINKEDIN_SCRAPE", query, count: results.length })
  return results
}

async function scrapeIndeed(query: string): Promise<JobPosting[]> {
  const results: JobPosting[] = []
  const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(query)}&sort=date`

  const html = await scrapeUrl(url)
  if (!html) return results

  const $ = cheerio.load(html)
  $(".job_seen_beacon").each((_, el) => {
    const title = $(el).find(".jobTitle").text().trim()
    const company = $(el).find(".companyName").text().trim()
    const location = $(el).find(".companyLocation").text().trim()
    const link = $(el).find(".jobTitle a").attr("href") || ""
    const snippet = $(el).find(".job-snippet").text().trim()

    if (title && company) {
      results.push({
        title,
        company,
        location,
        url: link.startsWith("http") ? link : `https://indeed.com${link}`,
        postedDate: new Date().toISOString(),
        site: "indeed",
        snippet,
      })
    }
  })

  logger.info({ stage: "INDEED_SCRAPE", query, count: results.length })
  return results
}

async function scrapeGlassdoor(query: string): Promise<JobPosting[]> {
  const results: JobPosting[] = []
  const url = `https://www.glassdoor.com/Search/search.htm?keyword=${encodeURIComponent(query)}`

  const html = await scrapeUrl(url)
  if (!html) return results

  const $ = cheerio.load(html)
  $(".JobCard_jobCardContainer__1kmmy, .job-card").each((_, el) => {
    const title = $(el).find(".jobTitle, .JobCard_jobTitle__4E2g9").text().trim()
    const company = $(el).find(".companyName, .EmployerProfile_employerName__1iSL5").text().trim()
    const location = $(el).find(".location, .JobCard_location__1VT4D").text().trim()
    const link = $(el).find("a").attr("href") || ""

    if (title && company) {
      results.push({
        title,
        company,
        location,
        url: link.startsWith("http") ? link : `https://glassdoor.com${link}`,
        postedDate: new Date().toISOString(),
        site: "glassdoor",
        snippet: `Hiring ${title}`,
      })
    }
  })

  logger.info({ stage: "GLASSDOOR_SCRAPE", query, count: results.length })
  return results
}

function jobsToCompanies(sourceId: string, brandId: string, jobs: JobPosting[]): any[] {
  const seen = new Map<string, any>()

  for (const job of jobs) {
    const key = job.company.toLowerCase()
    if (!seen.has(key)) {
      seen.set(key, {
        source_id: sourceId,
        brand_id: brandId,
        name: job.company,
        domain: null,
        hiring_signals: 1,
        latest_job: job.title,
        latest_job_url: job.url,
        latest_job_site: job.site,
      })
    } else {
      seen.get(key).hiring_signals++
    }
  }

  return Array.from(seen.values())
}

export const jobSpyExecutor: BatchExecutor<JobSpyConfig> =
  async ({ sourceId, brandId, config }, onBatch, batchSize = 10) => {
    const startTime = Date.now()

    try {
      const allJobs: JobPosting[] = []

      if (config.site === "all" || config.site === "linkedin") {
        const linkedinJobs = await scrapeLinkedIn(config.keywords)
        allJobs.push(...linkedinJobs)
      }

      if (config.site === "all" || config.site === "indeed") {
        const indeedJobs = await scrapeIndeed(config.keywords)
        allJobs.push(...indeedJobs)
      }

      if (config.site === "all" || config.site === "glassdoor") {
        const glassdoorJobs = await scrapeGlassdoor(config.keywords)
        allJobs.push(...glassdoorJobs)
      }

      const safeJobs = allJobs.slice(0, JOBSPY_MAX_ITEMS)
      const companies = jobsToCompanies(sourceId, brandId, safeJobs)

      for (let i = 0; i < companies.length; i += batchSize) {
        const batch = companies.slice(i, i + batchSize)
        await onBatch({
          companies: batch,
          contacts: [],
          meta: {} as any,
        })
        logger.info({ stage: "JOBSPY_BATCH", batch: Math.floor(i / batchSize) + 1, count: batch.length })
      }

      const duration = Date.now() - startTime
      logger.info({
        sourceId,
        brandId,
        keywords: config.keywords,
        totalJobs: safeJobs.length,
        companies: companies.length,
        duration_ms: duration,
      }, "JobSpy completed (streaming)")

    } catch (err: any) {
      throw new DiscoveryError(err?.message ?? "JobSpy executor failed", "retryable")
    }
  }