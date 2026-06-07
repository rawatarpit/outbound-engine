import axios from "axios"
import pino from "pino"

const logger = pino({ level: "debug" })

export interface HNStory {
  title: string
  story_text: string
  author: string
  url: string
  timestamp: number
  objectID: string
  points: number
  num_comments: number
}

export async function fetchHNStories(
  tags: string = "story",
  numericFilters: string = "created_at_i>timestamp",
  hitsPerPage: number = 30
): Promise<HNStory[]> {
  const now = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60)
  const url = `https://hn.algolia.com/api/v1/search`

  try {
    const response = await axios.get(url, {
      params: {
        tags,
        numericFilters: `created_at_i>${now}`,
        hitsPerPage,
        attributesToRetrieve: "title,story_text,author,url,created_at_i,objectID,points,num_comments"
      },
      timeout: 10000
    })

    if (!response.data?.hits) {
      logger.warn("No stories found in HN response")
      return []
    }

    const stories: HNStory[] = response.data.hits.map((hit: any) => ({
      title: hit.title || "",
      story_text: hit.story_text || "",
      author: hit.author || "",
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      timestamp: hit.created_at_i ? hit.created_at_i * 1000 : Date.now(),
      objectID: hit.objectID || "",
      points: hit.points || 0,
      num_comments: hit.num_comments || 0
    }))

    logger.info({ count: stories.length }, "Fetched HN stories")
    return stories

  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to fetch HN stories")
    return []
  }
}

export async function fetchHNStoriesByQuery(
  query: string,
  hitsPerPage: number = 20
): Promise<HNStory[]> {
  const url = `https://hn.algolia.com/api/v1/search`

  try {
    const response = await axios.get(url, {
      params: {
        query,
        tags: "story",
        hitsPerPage,
        attributesToRetrieve: "title,story_text,author,url,created_at_i,objectID,points,num_comments"
      },
      timeout: 10000
    })

    if (!response.data?.hits) {
      return []
    }

    return response.data.hits.map((hit: any) => ({
      title: hit.title || "",
      story_text: hit.story_text || "",
      author: hit.author || "",
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      timestamp: hit.created_at_i ? hit.created_at_i * 1000 : Date.now(),
      objectID: hit.objectID || "",
      points: hit.points || 0,
      num_comments: hit.num_comments || 0
    }))

  } catch (error: any) {
    logger.error({ query, error: error.message }, "Failed to fetch HN stories by query")
    return []
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
