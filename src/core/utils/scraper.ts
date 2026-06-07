import axios from "axios"
import { load } from "cheerio"
import pino from "pino"

const logger = pino({ level: "debug" })

async function tryAxios(url: string): Promise<string | null> {
  try {
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;

    const { data } = await axios.get(normalizedUrl, {
      timeout: 10000,
      maxRedirects: 3,
      validateStatus: (status) => status < 500,
    });

    if (typeof data !== "string") return null;

    const $ = load(data);

    $("script, style, noscript, nav, footer, header").remove();

    const title = $("title").text().trim().slice(0, 200)
    const bodyText = $("body").text().replace(/\s+/g, " ").trim()

    const text = title ? `Title: ${title}\n\n${bodyText}` : bodyText

    return text.length > 200 ? text : null;
  } catch (err: any) {
    logger.warn({ url, error: err?.message }, "Axios scrape failed")
    return null
  }
}

async function tryPlaywright(url: string, maxChars: number): Promise<string | null> {
  try {
    const { chromium } = await import("playwright")
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.goto(url, { waitUntil: "networkidle", timeout: 15000 })
      const text = await page.evaluate(() => document.body.innerText)
      return text.slice(0, maxChars)
    } finally {
      await browser.close()
    }
  } catch (err: any) {
    logger.warn({ url, error: err?.message }, "Playwright scrape failed")
    return null
  }
}

export async function scrapeUrl(url: string, maxChars: number = 8000): Promise<string | null> {
  const axiosResult = await tryAxios(url)
  if (axiosResult && axiosResult.length > 500) return axiosResult

  return tryPlaywright(url, maxChars)
}
