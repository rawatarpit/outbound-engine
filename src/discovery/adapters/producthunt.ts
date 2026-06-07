import axios from "axios"
import pino from "pino"
import cheerio from "cheerio"
import { randomUA } from "../utils/userAgent"

const logger = pino({ level: "debug" })

export interface PHProduct {
  name: string
  tagline: string
  url: string
  timestamp: number
  votes: number
  comments: number
  topics: string[]
  maker: string
}

export async function fetchProductHuntRSS(
  maxItems: number = 20
): Promise<PHProduct[]> {
  const rssUrl = "https://www.producthunt.com/feed"

  try {
    const response = await axios.get(rssUrl, {
      headers: {
        "User-Agent": randomUA(),
        "Accept": "application/rss+xml, application/xml, text/xml"
      },
      timeout: 10000
    })

    const $ = cheerio.load(response.data, { xmlMode: true })
    const products: PHProduct[] = []

    $("item").each((i, el) => {
      if (i >= maxItems) return false

      const $el = $(el)
      const title = $el.find("title").text().trim()
      const link = $el.find("link").text().trim()
      const pubDate = $el.find("pubDate").text().trim()
      const description = $el.find("description").text().trim()

      if (title && link) {
        const [name, tagline] = title.includes(":") ? title.split(":").map(s => s.trim()) : [title, ""]

        products.push({
          name,
          tagline,
          url: link,
          timestamp: pubDate ? new Date(pubDate).getTime() : Date.now(),
          votes: 0,
          comments: 0,
          topics: [],
          maker: ""
        })
      }
    })

    logger.info({ count: products.length }, "Fetched ProductHunt products via RSS")
    return products

  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to fetch ProductHunt RSS")

    if (error.response?.status === 403) {
      logger.warn("ProductHunt RSS returned 403 - trying HTML fallback")
      return fetchProductHuntHTML()
    }

    return []
  }
}

async function fetchProductHuntHTML(
  maxItems: number = 15
): Promise<PHProduct[]> {
  const url = "https://www.producthunt.com"

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": randomUA(),
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache"
      },
      timeout: 15000
    })

    const $ = cheerio.load(response.data)
    const products: PHProduct[] = []

    $('a[href*="/products/"]').each((i, el) => {
      if (i >= maxItems) return false

      const $el = $(el)
      const name = $el.text().trim()
      const href = $el.attr("href")

      if (name && href) {
        products.push({
          name,
          tagline: "",
          url: href.startsWith("http") ? href : `https://www.producthunt.com${href}`,
          timestamp: Date.now(),
          votes: 0,
          comments: 0,
          topics: [],
          maker: ""
        })
      }
    })

    logger.info({ count: products.length }, "Fetched ProductHunt products via HTML fallback")
    return products

  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to fetch ProductHunt via HTML")
    return []
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
