import axios from "axios"
import pino from "pino"

const logger = pino({ level: "debug" })

export async function extractContactPagesFromSitemap(domain: string): Promise<string[]> {
  try {
    const sitemapUrl = `https://${domain}/sitemap.xml`
    const response = await axios.get(sitemapUrl, { timeout: 8000 })
    const body = response.data as string

    const urlMatches = body.match(/<loc>([^<]+)<\/loc>/g)
    if (!urlMatches) return []

    const urls = urlMatches.map(m => m.replace(/<\/?loc>/g, ""))

    const contactPages = urls.filter(url =>
      /\/team|\/about|\/people|\/author|\/founder|\/leadership|\/staff|\/company\/team|\/who-we-are|\/meet-the-team|\/management|\/our-team/i.test(url)
    )

    return [...new Set(contactPages)]
  } catch {
    return []
  }
}
