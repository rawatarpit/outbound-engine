import pino from "pino"
import { chromium, Browser, Page } from "playwright"

const logger = pino({ level: "debug" })

export interface IHPost {
  title: string
  content: string
  author: string
  url: string
  timestamp: number
  replyCount: number
}

export async function fetchIndieHackersDiscussions(
  pageUrl: string = "https://www.indiehackers.com/forum",
  maxPosts: number = 15
): Promise<IHPost[]> {
  let browser: Browser | null = null
  const posts: IHPost[] = []

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      viewport: { width: 1280, height: 720 }
    })

    const page = await context.newPage()

    logger.info({ url: pageUrl }, "Navigating to IndieHackers")
    await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 30000 })

    await page.waitForTimeout(2000)

    const postElements = await page.$$('article, div[class*="post"], div[class*="thread"]')

    for (let i = 0; i < Math.min(postElements.length, maxPosts); i++) {
      try {
        const element = postElements[i]

        const title = await element.$eval('h1, h2, h3, a[class*="title"]', el => el.textContent?.trim() || "").catch(() => "")
        const content = await element.$eval('p, div[class*="content"], div[class*="body"]', el => el.textContent?.trim() || "").catch(() => "")
        const author = await element.$eval('a[class*="author"], span[class*="author"]', el => el.textContent?.trim() || "").catch(() => "unknown")
        const url = await element.$eval('a[href]', el => (el as HTMLAnchorElement).href).catch(() => pageUrl)
        const replyText = await element.$eval('span[class*="reply"], div[class*="reply"]', el => el.textContent?.trim() || "0").catch(() => "0")

        posts.push({
          title: title || "Untitled",
          content: content || "",
          author,
          url,
          timestamp: Date.now(),
          replyCount: parseInt(replyText) || 0
        })

        await page.waitForTimeout(500)

      } catch (err: any) {
        logger.warn({ index: i, error: err.message }, "Failed to extract post data")
      }
    }

    logger.info({ count: posts.length }, "Fetched IndieHackers posts")
    return posts

  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to fetch IndieHackers discussions")
    return posts
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

export async function fetchIHProductLaunches(maxPosts: number = 10): Promise<IHPost[]> {
  return fetchIndieHackersDiscussions(
    "https://www.indiehackers.com/forum/product-launches",
    maxPosts
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
