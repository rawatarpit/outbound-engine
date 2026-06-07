import axios from "axios"
import pino from "pino"
import cheerio from "cheerio"
import { randomUA } from "../utils/userAgent"

const logger = pino({ level: "debug" })

export interface RemoteOKJob {
  title: string
  company: string
  url: string
  timestamp: number
  location: string
  tags: string[]
  description: string
}

export async function fetchRemoteOKJobs(
  limit: number = 50
): Promise<RemoteOKJob[]> {
  const url = "https://remoteok.com/api"

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": randomUA(),
        "Accept": "application/json",
        "Origin": "https://remoteok.com",
        "Referer": "https://remoteok.com/"
      },
      timeout: 10000
    })

    if (!Array.isArray(response.data)) {
      logger.warn("Unexpected response format from RemoteOK")
      return []
    }

    const jobs: RemoteOKJob[] = response.data
      .filter((item: any) => item?.slug && item?.company)
      .slice(0, limit)
      .map((job: any) => ({
        title: job.position || job.title || "",
        company: job.company || "",
        url: job.url ? `https://remoteok.com${job.url}` : `https://remoteok.com/jobs/${job.slug}`,
        timestamp: job.date ? new Date(job.date).getTime() : Date.now(),
        location: job.location || "Remote",
        tags: Array.isArray(job.tags) ? job.tags : [],
        description: job.description || ""
      }))

    logger.info({ count: jobs.length }, "Fetched RemoteOK jobs")
    return jobs

  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to fetch RemoteOK jobs")

    if (error.response?.status === 403) {
      logger.warn("RemoteOK returned 403 - trying HTML scrape fallback")
      return fetchRemoteOKJobsHTML()
    }

    return []
  }
}

async function fetchRemoteOKJobsHTML(): Promise<RemoteOKJob[]> {
  const url = "https://remoteok.com"

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": randomUA(),
        "Accept": "text/html"
      },
      timeout: 15000
    })

    const $ = cheerio.load(response.data)
    const jobs: RemoteOKJob[] = []

    $("tr.job").each((i, el) => {
      const $el = $(el)
      const title = $el.find("h2").text().trim()
      const company = $el.find(".company").text().trim()
      const href = $el.find("a").first().attr("href")
      const tags: string[] = []

      $el.find(".tag").each((_, tag) => {
        tags.push($(tag).text().trim())
      })

      if (title && company) {
        jobs.push({
          title,
          company,
          url: href ? `https://remoteok.com${href}` : url,
          timestamp: Date.now(),
          location: "Remote",
          tags,
          description: ""
        })
      }
    })

    logger.info({ count: jobs.length }, "Fetched RemoteOK jobs via HTML fallback")
    return jobs

  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to fetch RemoteOK via HTML")
    return []
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
