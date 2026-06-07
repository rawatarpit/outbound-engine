import pino from "pino"
import { supabase, type BrandProfile, type BrandIntent } from "../../db/supabase"
import { embed } from "./embedder"
import type { RAGQuery, SimilarIntent, DiscoverySource } from "./types"

const logger = pino({ level: "info" })

const MAX_SIMILAR_INTENTS = 3
const SIMILARITY_THRESHOLD = 0.65

const ALL_SOURCES: DiscoverySource[] = [
  "google", "reddit", "hackernews", "news", "jobs",
  "freelance", "blogs", "community", "github", "hn_hiring",
  "yc", "producthunt", "indeed", "crunchbase", "wellfound",
  "techcrunch", "pushshift", "stackshare", "web_research", "forge_enrichment",
]

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the", "and", "for", "with", "this", "that", "are", "you", "our", "we", "to",
    "in", "on", "at", "by", "is", "it", "of", "or", "be", "an", "as", "will",
    "do", "not", "but", "if", "from", "has", "have", "had", "what", "when",
    "where", "who", "which", "how", "all", "any", "can", "etc", "get", "your",
    "want", "needs", "need", "looking", "hire", "build", "just", "that",
    "their", "them", "they", "about", "would", "could", "should", "been",
    "into", "more", "some", "than", "then", "also", "its", "than", "very",
    "was", "were", "been", "being", "each", "other", "such", "only", "own",
    "same", "so", "too", "very", "because", "these", "those", "while",
  ])

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))

  return [...new Set(words)].slice(0, 6)
}

function buildSourceQueries(
  similarIntents: SimilarIntent[],
  brandName: string,
): RAGQuery[] {
  const queries: RAGQuery[] = []

  for (const similar of similarIntents) {
    const keywords = extractKeywords(similar.intent_text)
    if (keywords.length === 0) continue

    // Source-specific query strategies
    const sourceQueries: Record<DiscoverySource, string[]> = {
      google: [
        keywords.join(" "),
        ...keywords.slice(0, 3).join(" "),
      ],
      reddit: [
        `${keywords.slice(0, 3).join(" ")} site:reddit.com`,
      ],
      hackernews: [
        keywords.join(" "),
      ],
      news: [
        `${keywords.slice(0, 3).join(" ")} funding OR launch OR partnership`,
      ],
      jobs: [
        `hiring ${keywords.slice(0, 3).join(" ")}`,
        `${keywords.slice(0, 3).join(" ")} careers job`,
      ],
      freelance: [
        `need ${keywords.slice(0, 3).join(" ")} freelancer`,
        `looking for ${keywords.slice(0, 3).join(" ")} hire project`,
      ],
      blogs: [
        `${keywords.slice(0, 3).join(" ")} how to building guide`,
        `${keywords.slice(0, 3).join(" ")} best practices implementation`,
      ],
      community: [
        `${keywords.slice(0, 3).join(" ")} help advice recommend`,
        `${keywords.slice(0, 3).join(" ")} problem solution tool`,
      ],
      github: [
        `topic:${keywords.slice(0, 2).join(" ").toLowerCase().replace(/[^a-z0-9]/g, "-")} stars:>10`,
        `${keywords.slice(0, 2).join(" ")} topic:saas in:readme`,
      ],
      hn_hiring: [
        `Ask HN: Who is hiring`,
      ],
      yc: [
        keywords.join(" "),
        `${keywords.slice(0, 3).join(" ")}`,
      ],
      producthunt: [
        keywords.join(" "),
        `${keywords.slice(0, 3).join(" ")}`,
      ],
      indeed: [
        `hiring ${keywords.slice(0, 3).join(" ")}`,
        `${keywords.slice(0, 3).join(" ")} job`,
      ],
      crunchbase: [
        `${keywords.slice(0, 3).join(" ")} funding`,
        `${keywords.slice(0, 3).join(" ")} company`,
      ],
      wellfound: [
        `${keywords.slice(0, 3).join(" ")} startup`,
      ],
      techcrunch: [
        `${keywords.slice(0, 3).join(" ")} funding`,
        `${keywords.slice(0, 3).join(" ")} launch`,
      ],
      pushshift: [
        `${keywords.slice(0, 3).join(" ")} subreddit:startups`,
        `${keywords.slice(0, 3).join(" ")} subreddit:entrepreneur`,
      ],
      stackshare: [
        `${keywords.slice(0, 3).join(" ")} stack`,
      ],
      web_research: [
        keywords.join(" "),
        `${keywords.slice(0, 3).join(" ")} company`,
        `${keywords.slice(0, 3).join(" ")} startup OR business OR saas`,
      ],
      forge_enrichment: [
        keywords.join(" "),
        `${keywords.slice(0, 3).join(" ")} company`,
      ],
    }

    for (const [source, texts] of Object.entries(sourceQueries)) {
      for (const text of texts) {
        queries.push({
          text,
          source: source as DiscoverySource,
          intent_id: similar.intent_id,
          signal: similar.signal,
          rag_context: `This search matches a known pattern: "${similar.intent_text}". Focus on finding the actual company behind this signal.`,
        })
      }
    }
  }

  return queries
}

export async function vectorSearch(
  queryEmbedding: number[],
  brandId: string,
  topK: number = MAX_SIMILAR_INTENTS,
  threshold: number = SIMILARITY_THRESHOLD,
): Promise<SimilarIntent[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`

  const { data, error } = await supabase.rpc("match_discovery_embeddings", {
    query_embedding: embeddingStr,
    match_threshold: threshold,
    match_count: topK,
    filter_brand_id: brandId,
  })

  if (error) {
    logger.warn({ error: error.message }, "Vector search fallback: RPC not available, using direct query")

    const { data: fallback, error: fallbackError } = await supabase
      .from("discovery_embeddings")
      .select("id, intent_id, content_text, metadata")
      .eq("brand_id", brandId)
      .eq("content_type", "brand_intent")
      .limit(topK)

    if (fallbackError || !fallback?.length) {
      return []
    }

    return fallback.map(r => ({
      intent_id: r.intent_id || "",
      intent_text: r.content_text,
      signal: (r.metadata as any)?.signals?.[0] || "pain",
      similarity: 1.0,
    }))
  }

  return (data || []).map((r: any) => ({
    intent_id: r.intent_id || "",
    intent_text: r.content_text,
    signal: r.signal || (r.metadata as any)?.signals?.[0] || "pain",
    similarity: r.similarity || 1.0,
  }))
}

export async function buildRAGQueries(
  brand: BrandProfile,
  intents: BrandIntent[],
  maxQueries: number = 20,
  clientId?: string,
): Promise<RAGQuery[]> {
  try {
    const brandContext = [
      brand.brand_name,
      brand.product,
      brand.audience,
      brand.positioning,
    ].filter(Boolean).join(". ")

    if (!brandContext) {
      logger.warn({ brand: brand.brand_name }, "No brand context for RAG, falling back to empty queries")
      return []
    }

    const queryEmbedding = await embed(brandContext, clientId)

    let similarIntents = await vectorSearch(queryEmbedding, brand.id)

    if (similarIntents.length === 0) {
      logger.info({ brand: brand.brand_name }, "No similar intents found via vector search, using top intents directly")
      for (const intent of intents.slice(0, 3)) {
        similarIntents.push({
          intent_id: intent.id,
          intent_text: intent.intent,
          signal: intent.signals[0] || "pain",
          similarity: 1.0,
        })
      }
    }

    const queries = buildSourceQueries(similarIntents, brand.brand_name || brand.product)

    // Shuffle to mix sources
    for (let i = queries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queries[i], queries[j]] = [queries[j], queries[i]]
    }

    logger.info({ brand: brand.brand_name, count: queries.length }, "Built RAG queries with keyword extraction")
    return queries.slice(0, maxQueries)

  } catch (err: any) {
    logger.error({ error: err.message }, "RAG query building failed, falling back to keyword queries")

    const fallback: RAGQuery[] = []
    for (const intent of intents.slice(0, 3)) {
      const keywords = extractKeywords(intent.intent)
      if (keywords.length === 0) continue

      for (const source of ALL_SOURCES) {
        fallback.push({
          text: keywords.join(" "),
          source,
          intent_id: intent.id,
          signal: intent.signals[0] || "pain",
          rag_context: "",
        })
      }
    }
    return fallback.slice(0, maxQueries)
  }
}
