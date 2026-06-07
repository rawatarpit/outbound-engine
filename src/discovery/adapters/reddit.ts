import axios from "axios"
import pino from "pino"
import { randomUA } from "../utils/userAgent"

const logger = pino({ level: "debug" })

export interface RedditPost {
  title: string
  body: string
  author: string
  url: string
  timestamp: number
  subreddit: string
}

export async function fetchRedditPosts(
  subreddit: string = "startups",
  limit: number = 25
): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=${limit}`

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": randomUA(),
        "Accept": "application/json"
      },
      timeout: 10000
    })

    if (!response.data?.data?.children) {
      logger.warn({ subreddit }, "No posts found in Reddit response")
      return []
    }

    const posts: RedditPost[] = response.data.data.children.map((child: any) => {
      const post = child.data
      return {
        title: post.title || "",
        body: post.selftext || "",
        author: post.author || "[deleted]",
        url: `https://reddit.com${post.permalink}`,
        timestamp: post.created_utc ? post.created_utc * 1000 : Date.now(),
        subreddit: post.subreddit || subreddit
      }
    })

    logger.info({ subreddit, count: posts.length }, "Fetched Reddit posts")
    return posts

  } catch (error: any) {
    logger.error({ subreddit, error: error.message }, "Failed to fetch Reddit posts")
    if (error.response?.status === 403) {
      logger.warn({ subreddit }, "Reddit returned 403 - may need different approach")
    }
    return []
  }
}

export async function fetchMultipleSubreddits(
  subreddits: string[] = ["startups", "entrepreneur", "smallbusiness"],
  limitPerSubreddit: number = 10
): Promise<RedditPost[]> {
  const allPosts: RedditPost[] = []

  for (const subreddit of subreddits) {
    const posts = await fetchRedditPosts(subreddit, limitPerSubreddit)
    allPosts.push(...posts)
    await sleep(1500)
  }

  return allPosts
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
